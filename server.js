require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const routes = require('./routes');

app.use(bodyParser.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
	res.send(`Hello User! The application is working! `);
});

app.use('/', routes);

app.use((req, res) => {
	res.status(404).sendFile(path.join(__dirname, 'public', '404.jpg'));
});

const server = () => {
	app.listen(
		process.env.PORT,
		console.log('Server started on port ' + process.env.PORT)
	);
};

module.exports = server;
