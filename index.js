const _ = require('lodash');
const slsk = require('slsk-client');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
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

const convertToOpus = (inputFilePath, outputFilePath, bitrate, callback) => {
    ffmpeg(inputFilePath)
        .toFormat('opus')
        .audioBitrate(bitrate)
        .save(outputFilePath)
        .on('end', callback)
        .on('error', (err) => console.error(err));
};

const retrieveFile = (soulseek, chatId, result, filename, bitrate) => {
    const downloadPath = `${__dirname}/download/${filename}`;
    const opusPath = `${__dirname}/download/${filename.replace('.mp3', '.opus')}`;

    sendMessage(chatId, `Iniciando descarga de "${filename}"...`);
    soulseek.download({ file: result, path: downloadPath }, (err, data) => {
        if (err) { handleErr(chatId, err); }
        sendMessage(chatId, `Descarga de "${downloadPath}" completada! Convirtiendo a Opus...`);

        convertToOpus(downloadPath, opusPath, bitrate, () => {
            sendMessage(chatId, `¡Conversión a Opus completada! Enviando archivo...`);
            bot.sendAudio(chatId, opusPath).catch(err => handleErr(chatId, err));
            fs.unlinkSync(downloadPath);
            sendMessage(chatId, `Archivo "${filename}" enviado con éxito!`);
        });
    });
};

const onSearch = async (soulseek, chatId, query) => {
    sendMessage(chatId, `Buscando: ${query}`);
    const req = query.toLowerCase().replace(' - ', ' ');
    soulseek.search({ req, timeout: 20000 }, (err, rawResults) => {
        if (err) { handleErr(chatId, err); }
        const sorted = _.sortBy(rawResults, ['speed', 'slots']);
        searchResults = sorted.filter((r) => filterResult(r, query));
        if (searchResults.length === 0) {
            const resultsString = _.map(sorted, formatResult).join('\n');
            sendMessage(chatId, `No se encontraron resultados (${rawResults.length} sin filtrar)\n\n${resultsString}`);
            return;
        }
        const topResults = searchResults.slice(0, 5);
        const resultsString = _.map(topResults, (r, index) => `${index + 1}. ${formatResult(r)}`).join('\n');
        sendMessage(chatId, `Se encontraron ${searchResults.length} resultados (${rawResults.length} sin filtrar)\nTop 5 resultados:\n${resultsString}`);
        sendMessage(chatId, 'Selecciona el número del resultado que deseas descargar (1-5):');
    });
};

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (/^\d+$/.test(text) && searchResults.length > 0) {
        const index = parseInt(text, 10) - 1;
        if (index >= 0 && index < searchResults.length) {
            const result = searchResults[index];
            const filename = basename(result.file);

            sendMessage(chatId, 'Selecciona el bitrate para la conversión a Opus:\n1. 128 kbps\n2. 192 kbps\n3. 256 kbps\n4. 320 kbps\n5. 368 kbps');
            
            bot.once('message', (msg) => {
                const bitrateSelection = parseInt(msg.text.trim(), 10);
                const bitrates = [128, 192, 256, 320, 368];
                const selectedBitrate = bitrates[bitrateSelection - 1] || 320;

                retrieveFile(slskClient, chatId, result, filename, selectedBitrate);
            });
        } else {
            sendMessage(chatId, 'Índice no válido. Inténtalo de nuevo.');
        }
    }
});

const main = async (soulseek) => {
    console.log("Starting...");
    bot.onText(/\/search (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        const query = match[1].trim();
        onSearch(soulseek, chatId, query);
    });
};

(async () => {
    slsk.connect({ user: 'txy', pass: 'ttxxyy' }, async (err, client) => {
        if (err) {
            console.error(err);
            return;
        }
        global.slskClient = client;
        await main(client);
    });
})().catch(err => console.error(err));
