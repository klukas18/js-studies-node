const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getAdsCollection } = require('./db');
const debug = require('debug')('app:debug');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const bcrypt = require('bcryptjs');

const users = {
	user1: bcrypt.hashSync('password1', 10),
	user2: bcrypt.hashSync('password2', 10),
	user3: bcrypt.hashSync('password3', 10),
};

// DEBUG MODE

const isDebugMode = process.argv.includes('debug');
if (isDebugMode) {
	const accessLogStream = fs.createWriteStream(
		path.join(__dirname, 'access.log'),
		{ flags: 'a' }
	);
	router.use(morgan(':date[iso] :method :url', { stream: accessLogStream }));
	debug('Logging is enabled');
}

// AD SCHEMA

const adSchema = Joi.object({
	title: Joi.string().required(),
	author: Joi.string().required(),
	description: Joi.string().required(),
	category: Joi.string().required(),
	tags: Joi.array().items(Joi.string()).required(),
	price: Joi.number().required(),
	isAScam: Joi.boolean().required(),
});

function validateAd(req, res, next) {
	const { error } = adSchema.validate(req.body);
	if (error) {
		return res.status(400).send(error.details[0].message);
	}
	if (req.body.isAScam) {
		return res
			.status(400)
			.send(
				'Error: Ads marked as scam are not allowed! Calling the police! 🚨 '
			);
	}

	next();
}

async function authenticate(req, res, next) {
	const authHeader = req.headers.authorization;

	if (!authHeader) {
		return res
			.status(401)
			.send('Unauthorized: No Authorization header provided');
	}

	const [username, password] = Buffer.from(authHeader.split(' ')[1], 'base64')
		.toString()
		.split(':');

	if (!users[username] || !bcrypt.compareSync(password, users[username])) {
		return res
			.status(403)
			.send('Forbidden: Invalid user or incorrect password');
	}

	req.user = username;
	next();
}

// 1. Search for ads
router.get('/ads/search', async (req, res) => {
	try {
		const adsCollection = await getAdsCollection();

		// Build the query object based on the provided search criteria
		const query = {};
		if (req.query.title) {
			query.title = req.query.title;
		}
		if (req.query.author) {
			query.author = req.query.author;
		}
		if (req.query.category) {
			query.category = req.query.category;
		}
		if (req.query.price) {
			query.price = Number(req.query.price);
		}
		if (req.query.isAScam) {
			query.isAScam = req.query.isAScam === 'true';
		}

		// Find the ads that match the query
		const ads = await adsCollection.find(query).toArray();

		if (ads.length === 0) {
			console.log('No ads found based on the search criteria.');
			return res.status(404).send('No ads found matching search criteria.');
		} else {
			res.status(200).send(ads);
			console.log(JSON.stringify(ads, null, 2));
		}
	} catch (error) {
		console.error(error);
		res
			.status(404)
			.send(
				'An error occurred while searching for ads, could not retrieve the data.'
			);
	}
});

// 2. Return all ads from the backend
router.get('/ads', async (req, res) => {
	try {
		const adsCollection = await getAdsCollection();
		const ads = await adsCollection
			.find({}, { projection: { _id: 0, buffer: 0 } })
			.toArray();
		console.table(ads);
		res.status(200).send(ads);
	} catch (error) {
		console.error(error);
		res
			.status(500)
			.send(`An error occurred while retrieving ads from the database.`);
	}
});

// 3. Return a single ad
router.get('/ads/:id', async (req, res) => {
	try {
		const adsCollection = await getAdsCollection();
		const ad = await adsCollection.findOne(
			{ _id: new ObjectId(req.params.id) },
			{ projection: { _id: 0, buffer: 0 } }
		);
		console.log(ad);

		res.format({
			'text/plain': function () {
				res.status(302).send(JSON.stringify(ad));
			},

			'text/html': function () {
				res.status(302).send(`<div>${JSON.stringify(ad, null, 2)}</div>`);
			},

			'application/json': function () {
				res.status(302).json(ad);
			},

			default: function () {
				res
					.status(406)
					.send(
						'Not Acceptable format! Choose one of the available formats: text/plain, text/html, application/json'
					);
			},
		});
	} catch (error) {
		console.error(error);
		res
			.status(500)
			.send(`An error occurred while retrieving the ad from the database.`);
	}
});

// 4. Save a new ad in database
router.post(
	'/ads/add',
	authenticate,
	validateAd,
	express.json(),
	async (req, res) => {
		try {
			const adsCollection = await getAdsCollection();

			req.body.userId = req.user;
			req.body.date = new Date();

			const result = await adsCollection.insertOne(req.body);
			const newAd = await adsCollection.findOne(
				{ _id: result.insertedId },
				{ projection: { _id: 0, buffer: 0 } }
			);

			console.log('New ad successfully added to the database!');
			console.log(newAd);
			res.status(201).send(newAd);
		} catch (error) {
			console.error(error);
			res.status(500).send(`An error occurred while saving the ad.`);
		}
	}
);

// 5. Modify selected ad
router.put('/ads/:id', authenticate, express.json(), async (req, res) => {
	try {
		const adsCollection = await getAdsCollection();

		const ad = await adsCollection.findOne({
			_id: new ObjectId(req.params.id),
		});

		if (ad.userId !== req.user) {
			return res
				.status(403)
				.send('Forbidden: You can only modify ads that you have added');
		}

		req.body.modifiedDate = new Date();
		req.body.userId = req.user;

		for (const key in req.body) {
			if (key === 'date' || key === 'modifiedDate') continue;
			if (typeof req.body[key] !== typeof ad[key]) {
				return res
					.status(400)
					.send(`Invalid type for property ${key}, expected ${typeof ad[key]}`);
			}
		}

		const result = await adsCollection.updateOne(
			{ _id: new ObjectId(req.params.id) },
			{ $set: req.body }
		);

		if (result.modifiedCount === 1) {
			const modifiedAd = await adsCollection.findOne({
				_id: new ObjectId(req.params.id),
			});
			console.log('Ad successfully updated!');
			console.log('modifiedAd:', modifiedAd);
			res.status(200).send(modifiedAd);
		} else {
			res.status(404).send(`Ad not found`);
		}
	} catch (error) {
		console.error('Error:', error);
		res.status(500).send(`An error occurred while updating the ad.`);
	}
});

// 6. Remove selected ad
router.delete('/ads/:id', authenticate, async (req, res) => {
	try {
		const adsCollection = await getAdsCollection();

		const ad = await adsCollection.findOne({
			_id: new ObjectId(req.params.id),
		});

		if (ad.userId !== req.user) {
			return res
				.status(403)
				.send('Forbidden: You can only delete ads that you have added');
		}

		const result = await adsCollection.deleteOne({
			_id: new ObjectId(req.params.id),
		});

		if (result.deletedCount === 1) {
			console.log(`Ad deleted successfully!`);
			res.status(200).send(`Ad deleted successfully!`);
		} else {
			res.status(404).send(`Could not delete - Ad not found!`);
		}
	} catch (error) {
		console.error(error);
		res.status(500).send(`An error occurred while deleting the ad.`);
	}
});

// 7. Heartbeat
router.get('/heartbeat', (req, res) => {
	const utcDate = new Date(new Date().toUTCString());
	res.send(`Current time and date: ${utcDate}`);
	console.log(`Current time and date: ${utcDate}`);
});

module.exports = router;
