const { MongoClient, ServerApiVersion } = require('mongodb');

const client = new MongoClient(process.env.CONNECTION_STRING, {
	serverApi: ServerApiVersion.v1,
});

let adsCollection;

async function connect() {
	try {
		await client.connect();
		console.log('Connected successfully to Database');
		const db = client.db(process.env.DATABASE_NAME);
		adsCollection = db.collection('ads');
	} catch (err) {
		console.error('Failed to connect to the database', err);
		process.exit(1);
	}
}

connect();

module.exports.getAdsCollection = async function () {
	return adsCollection;
};
