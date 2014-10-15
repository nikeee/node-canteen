///<reference path="typings/node/node.d.ts"/>
///<reference path="typings/restify/restify.d.ts"/>

///<reference path="./interfaces.ts"/>
///<reference path="./interfaces-shared.ts"/>

import restify = require("restify");
import Menu = require("Menu");

// TODO: Documentation/JSDoc

var server = restify.createServer();

server.name = "canteen";
server.version = "1.0.0";
server.url = process.env["npm_package_config_url"] || "http://canteen.holz.nu";
var port = parseInt(process.env["PORT"]) || parseInt(process.env["npm_package_config_port"]) || 8080

server.use(restify.CORS());
server.use(restify.fullResponse());

// TODO: Make better use of restify API.

server.on("uncaughtException", (req, res, route, error) => {
	console.error(route + ":\n");
	console.dir(error);

	res.send(500, {
		success: false,
		message: error
	});
});
server.get("/canteens", (rq, res, next) => {
	res.send({
		availableCanteens: Object.keys(Menu.availableCanteens)
	});
	next();
});
server.get("/menu/:canteen", (req, res, next) => {

	res.charSet("utf-8");

	console.log("Serving response.");

	Menu.getCachedOrRequestNew(req.params.canteen, (err, menu) => {
		if(err)
		{
			res.send(500, {
				success: false,
				message: err.message
			});
		}
		else
		{
			res.send(menu);
		}
		next();
	});
});

server.listen(port, () => console.log("%s listening at %s", server.name, server.url));
