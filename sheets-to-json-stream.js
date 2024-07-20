const google = require('@googleapis/sheets');
const { JWT } = require('google-auth-library');
const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
]

class SheetsToJSON {
    #sheets = {}
    metadata = new Map()
    #google
    #JWT

    constructor({ google, JWT }) {
        this.#google = google
        this.#JWT = JWT
    }

    async getSheetDataByRange({ spreadsheetId, range }) {
        const valuesResponse = await this.#sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        return valuesResponse
    }

    async getSheetsMetadata({ spreadsheetId }) {
        const response = await this.#sheets.spreadsheets.get({
            spreadsheetId,
        });

        const sheetsRequest = response.data.sheets.map(async sheet => {
            const sheetTitle = sheet.properties.title;

            // Fetch the first row to use as headers
            const range = `${sheetTitle}!A1:1`;
            const valuesResponse = await this.getSheetDataByRange({ spreadsheetId, range })
            const headers = valuesResponse.data.values ? valuesResponse.data.values[0] : [];

            // Calculate the cell range in A1 notation
            const rowCount = sheet.properties.gridProperties.rowCount;
            const columnCount = sheet.properties.gridProperties.columnCount;
            const columnLetter = this.getColumnLetter(columnCount);
            const cellsRange = `A1:${columnLetter}${rowCount}`;

            return {
                title: sheetTitle,
                rowCount: rowCount,
                columnCount: columnCount,
                frozenRowCount: sheet.properties.gridProperties.frozenRowCount,
                sheetType: sheet.properties.sheetType,
                headers: headers,
                cellsRange: cellsRange,
            };
        })
        const sheetData = await Promise.all(sheetsRequest);

        const metadata = {
            title: response.data.properties.title,
            sheets: sheetData,
        };

        return metadata;
    }

    getColumnLetter(columnNumber) {
        let letter = '';
        while (columnNumber > 0) {
            const remainder = (columnNumber - 1) % 26;
            letter = String.fromCharCode(65 + remainder) + letter;
            columnNumber = Math.floor((columnNumber - 1) / 26);
        }
        return letter;
    }

    async fetchSheetsMetadata(googleSheetsConfig, spreadsheetId) {
        const auth = new this.#JWT({
            email: googleSheetsConfig.client_email,
            key: googleSheetsConfig.private_key,
            scopes: SCOPES,
        });

        this.#sheets = this.#google.sheets({ version: 'v4', auth });

        const metadata = await this.getSheetsMetadata({ spreadsheetId });
        return metadata;
    }

}


module.exports = function (RED) {

    const sheetsToJSON = new SheetsToJSON({ google, JWT })
    async function onSheetOptionsRequest(req, res) {
        try {

            const { sheetId: spreadsheetId, credentials, gauthNodeId } = req.body
            let googleSheetsConfig = credentials

            if (!credentials.client_email) {
                const config = RED.nodes.getNode(gauthNodeId)?.credentials?.config
                if (!config) return res.status(200).send({})

                googleSheetsConfig = JSON.parse(config)
            }

            if (!spreadsheetId || !googleSheetsConfig?.private_key || !googleSheetsConfig?.client_email) {
                const message = `Invalid request sent with: ${JSON.stringify({ spreadsheetId, credentials })}`
                RED.log.error(message);
                return res.status(400).send(message);
            }

            const metadata = await sheetsToJSON.fetchSheetsMetadata(googleSheetsConfig, spreadsheetId);
            sheetsToJSON.metadata.set(spreadsheetId, metadata);

            return res.json(metadata);
        } catch (error) {
            console.error(error.stack)

            RED.log.error(error)
            RED.log.error(`ensure the credentials data is correct, you've been using the correct spreadsheet id and have the proper access to it`)
            res.status(500).json({ error })
        }
    }

    function SheetsToJSONModule(ctx) {
        RED.nodes.createNode(this, ctx);
        const node = this;
        const context = {
            sheetId: ctx.sheetId,
            range: ctx.range,
            columns: ctx.columns
        }

        // const columns = ctx.columns
        const creds = RED.nodes.getNode(ctx.credentials);

        node.on('input', function (msg) {
            // const isRange = typeof columns[0] === 'string'
            // const meta = sheetsMetadata.get(sheetId)
            // if (!meta) return node.error('couldnt find the sheet')

            // node.warn(meta)

            // if (isRange) {
            //     node.warn('handle as range')
            // }
            // else {
            //     // all the file
            //     // parse each line
            //     //  parse 1000 items per time

            //     node.warn('handle columns')
            // }

            node.send(msg);
        });

        node.on('close', async function () {

        });
    }

    RED.httpAdmin.post('/sheets-to-json-stream/sheets-options', onSheetOptionsRequest);
    RED.nodes.registerType('sheets-to-json-stream', SheetsToJSONModule, {
        credentials: {
            config: {}
        }
    });
};

