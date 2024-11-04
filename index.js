const _ = require('lodash');
const slsk = require('slsk-client');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const https = require('https');
const ffmpeg = require('fluent-ffmpeg');

const bot = new TelegramBot('8114534699:AAFrPVLQDRBmYfALnHL1lKzD4E-Q5mC_HT8', { polling: true });

let searchResults = [];

const FILTER_WORDS = [
    'remix', 'rmx', 'edit', 'cover', 'live', 'mix', 'bootleg', 'acapella', 'mashup',
];

const humanFilesize = (size) => {
    const i = Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) * 1 + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
};

const handleErr = (chatId, err) => {
    console.error(err);
    if (chatId) {
        bot.sendMessage(chatId, err.toString());
    }
};

const sendMessage = (chatId, msg) => {
    console.log(msg);
    if (chatId) {
        bot.sendMessage(chatId, msg);
    }
};

const basename = (filename) => {
    const split = filename.split("\\");
    return split[split.length - 1];
};

const filterResult = (r, query) => {
    const filename = basename(r.file);
    const splitQuery = query.split(' - ');
    const splitFilename = filename.split(' - ');

    return (r.bitrate <= 320
        && r.file.endsWith('.mp3')
        && _.every(splitQuery, (piece, i) => {
            try {
                return splitFilename[i].toLowerCase().includes(piece.toLowerCase());
            } catch (e) {
                return false;
            }
        })
        && _.every(FILTER_WORDS, (word) => {
            return !filename.toLowerCase().includes(word) || query.toLowerCase().includes(word);
        })
    );
};

const formatResult = (r) => {
    return `|${r.bitrate}| ${basename(r.file)} (${humanFilesize(r.size)}) [slots: ${r.slots}]`;
};

const convertToOpus = (inputFilePath, outputFilePath, callback) => {
    ffmpeg(inputFilePath)
        .toFormat('opus')
        .audioBitrate(320)
        .save(outputFilePath)
        .on('end', callback)
        .on('error', (err) => console.error(err));
};

const retrieveFile = (soulseek, chatId, result, filename) => {
    const downloadPath = `${__dirname}/download/${filename}`;
    const opusPath = `${__dirname}/download/${filename.replace('.mp3', '.opus')}`;

    if (fs.existsSync(opusPath)) {
        sendMessage(chatId, `File already exists. Sending "${opusPath}"...`);
        bot.sendAudio(chatId, opusPath).catch(err => handleErr(chatId, err));
        return;
    }

    soulseek.download({ file: result, path: downloadPath }, (err, data) => {
        if (err) { handleErr(chatId, err); }
        sendMessage(chatId, `Download of "${downloadPath}" completed! Converting to Opus...`);

        convertToOpus(downloadPath, opusPath, () => {
            sendMessage(chatId, `Conversion to Opus completed! Sending file...`);
            bot.sendAudio(chatId, opusPath).catch(err => handleErr(chatId, err));
            fs.unlinkSync(downloadPath);
        });
    });
};

const onSearch = async (soulseek, chatId, query) => {
    sendMessage(chatId, `Searching: ${query}`);
    const req = query.toLowerCase().replace(' - ', ' ');
    soulseek.search({ req, timeout: 20000 }, (err, rawResults) => {
        if (err) { handleErr(chatId, err); }
        const sorted = _.sortBy(rawResults, ['speed', 'slots']);
        searchResults = sorted.filter((r) => filterResult(r, query));
        if (searchResults.length === 0) {
            const resultsString = _.map(sorted, formatResult).join('\n');
            sendMessage(chatId, `Found 0 results (${rawResults.length} unfiltered)\n\n${resultsString}`);
            return;
        }
        const bestResult = searchResults[searchResults.length - 1];
        sendMessage(chatId, `Found ${searchResults.length} results (${rawResults.length} unfiltered)\nBest result: ${formatResult(bestResult)}`);
    });
};

const onDownload = (chatId, index) => {
    if (!searchResults[index]) {
        sendMessage(chatId, `Invalid index: ${index}`);
        return;
    }
    const result = searchResults[index];
    const filename = basename(result.file);
    retrieveFile(soulseek, chatId, result, filename);
};

const main = async (soulseek) => {
    console.log("Starting...");
    bot.onText(/\/search (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const query = match[1].trim();
        onSearch(soulseek, chatId, query);
    });

    bot.onText(/\/download (\d+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const index = parseInt(match[1], 10);
        onDownload(chatId, index);
    });
};

(async () => {
    slsk.connect({ user: 'txy', pass: 'ttxxyy' }, async (err, client) => {
        if (err) {
            console.error(err);
            return;
        }
        await main(client);
    });
})().catch(err => console.error(err));
