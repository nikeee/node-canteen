///<reference path="typings/node/node.d.ts"/>
///<reference path="typings/request/request.d.ts"/>

///<reference path="./interfaces.ts"/>
///<reference path="./interfaces-shared.ts"/>

import request = require("request");
import fs = require("fs");

import ParserProxy = require("./ParserProxy");
import UniKasselParser = require("./UniKasselParser");
import LegacyUniKasselParser = require("./LegacyUniKasselParser");

class Menu
{
	public static availableCanteens: ICanteenList = {
		wilhelmshoehe: {
			info: {
				name: "Mensa Wilhelmshöher Allee",
				location: {
					lat: 51.31116,
					long: 9.47467
				}
			},
			url: "http://www.studentenwerk-kassel.de/189.html",
			parser: new UniKasselParser(),
			mealCount: 5
		},
		hopla: {
			info: {
				name: "Zentralmensa Uni Kassel",
				locationDescription: "Holländischer Platz",
				location: {
					lat: 51.32318,
					long: 9.50626
				}
			},
			url: "http://www.studentenwerk-kassel.de/188.html",
			parser: new UniKasselParser(),
			mealCount: 6
		},
		menzelstrasse: {
			info: {
				name: "Mensa Menzelstraße",
				location: {
					lat: 51.305234,
					long: 9.489587
				}
			},
			url: "http://www.studentenwerk-kassel.de/195.html",
			parser: new LegacyUniKasselParser(),
			mealCount: 2 /* actually there are more, but they don't get used */
		},
		plett: {
			info: {
				name: "Mensa Heinrich-Plett-Straße",
				location: {
					lat: 51.282003,
					long: 9.447503
				}
			},
			url: "http://www.studentenwerk-kassel.de/187.html",
			parser: new UniKasselParser(),
			mealCount: 4
		},
		witzenhausen: {
			info: {
				name: "Mensa Witzenhausen",
				location: {
					lat: 51.343777,
					long: 9.859827
				}
			},
			url: "http://www.studentenwerk-kassel.de/415.html",
			parser: new LegacyUniKasselParser(),
			mealCount: 4
		}
	};

	public static getCachedOrRequestNew(canteen: string, cb: (err: Error, data: IParseResult) => void) : void
	{
		if(!Menu._hasInit)
			Menu.init();
		if(!cb)
			cb = (e, d) => {};
		if(!canteen || typeof Menu.availableCanteens[canteen.toLowerCase()] === "undefined")
		{
			cb(new Error("Canteen not available"), null);
			return;
		}

		Menu.availableCanteens[canteen].parserProxy.getCurrentMenu((e, d) => cb(e, d));
	}

	private static _hasInit = false;
	private static init(): void
	{
		var maxAge = parseInt(process.env["npm_package_config_maxMenuAge"]);

		for(var key in Menu.availableCanteens)
		{
			Menu.availableCanteens[key].parserProxy = new ParserProxy(key, maxAge);
		}
		Menu._hasInit = true;
	}

	public static pull(canteen: string, cb: (err: Error, data: IParseResult) => void) : void
	{
		if(!Menu._hasInit)
			Menu.init();

		if(!cb)
			cb = (e, d) => {};
		if(!canteen || typeof Menu.availableCanteens[canteen.toLowerCase()] === "undefined")
		{
			cb(new Error("Canteen not available"), null);
			return;
		}

		var canteenData = Menu.availableCanteens[canteen];

		if(fs.existsSync(canteenData.url))
		{
			fs.readFile(canteenData.url, (err, body) => {
				if(err)
					return cb(err, null);
				Menu.handleBody(canteenData, body.toString(), cb);
			})
		}
		else
		{
			request.get(canteenData.url, null, (err, resp, body) => {
				if(err)
					return cb(err, null);
				if(resp.statusCode === 200)
				{
					Menu.handleBody(canteenData, body, cb);
				}
			});
		}
	}

	private static handleBody(canteenData: ICanteenItem, body: string, cb: (err: Error, data: IParseResult) => void) : void
	{
		var parseRes = canteenData.parser.parse(canteenData, body);
		//if(!parseRes.success)
		//	return cb(new Error(parseRes.message || "Failed to parse menu."), null);
		//cb(null, parseRes.menu);
		cb(null, parseRes);
	}
}

export = Menu;
