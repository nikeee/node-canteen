///<reference path="typings/node/node.d.ts"/>
///<reference path="typings/cheerio/cheerio.d.ts"/>
///<reference path="typings/restify/restify.d.ts"/>
///<reference path="typings/request/request.d.ts"/>
///<reference path="typings/moment/moment.d.ts"/>

///<reference path="./interfaces.ts"/>
///<reference path="./interfaces-shared.ts"/>

import restify = require("restify");
import cheerio = require("cheerio");
import http = require("http");
import request = require("request");
import moment = require("moment");
import fs = require("fs");

// TODO: Split into multi-file-modules
// TODO: Documentation/JSDoc

class ParserProxy implements IParserProxy
{
	private _ts: Date;
	private _currentMenu: IParseResult = null;
	private _hasInitialList = false;

	/**
	 * Returns the age of the current caced plan in seconds.
	 */
	public getMenuAge(): number
	{
		return moment().subtract(this._ts).seconds();
	}

	constructor(public canteen: string, public maxAge: number)
	{
		if(!canteen)
			throw "No canteen?";

		this._ts = new Date(0);
	}

	public getCurrentMenu(cb: (err: Error, data: IParseResult) => void): void
	{
		if(!cb)
			cb = (e, d) => {};

		if(!this._hasInitialList || this.getMenuAge() >= this.maxAge)
		{
			this.refresh((e, d) => {
				if(e)
				{
					cb(e, null);
					return;
				}
				this._hasInitialList = true;
				this._ts = new Date();
				this._currentMenu = d;
				cb(null, this._currentMenu);
			});
		}
		else
		{
			cb(null, this._currentMenu);
		}
	}

	public refresh(cb: (err: Error, data: IParseResult) => void): void
	{
		// this._ts = new Date();
		if(!this.canteen)
		{
			cb(new Error("No canteen available."), this._currentMenu);
			return;
		}
		Menu.pull(this.canteen, (err, menu) => cb(err, menu));
	}
}

class UniKasselParser implements IMenuParser
{
	public parse(canteen: ICanteenItem, response: string): IParseResult
	{
		var $ = cheerio.load(response);
		var $tbody = $("div.mainmensa table");

		// "Speiseplan vom 08.09. bis 12.09.2014"
		var intervalStr = $("tr.thead h4", $tbody).text();
		var validity = this.parseValidityInterval(intervalStr);

		var meals = this.parseMeals($, $tbody, canteen);

		return {
			success: true,
			menu: {
				info: canteen.info,
				validity: {
					from: this.fixDateOffset(validity.from),
					until: this.fixDateOffset(validity.until)
				},
				currency: "€",
				meals: meals,
			}
		};
	}

	private parseMeals($: CheerioStatic, $tbody: Cheerio, canteen: ICanteenItem): IMeals
	{
		var numMeals = canteen.mealCount || 1;

		var offset = 4;

		var meals: IMeals = {};

		var $prices = $("tr.price_row", $tbody);
		var $items = $("tr.items_row", $tbody);

		for(var row = 0; row < numMeals; ++row)
		{
			var trChildId = offset + row * 2;
			var $currentRow = $items[row];
			var $rowBeneath = $prices[row];

			// "Essen 1", "Essen 2", "Essen 3 oder 4", "Angebot des Tages"
			var genericMealName = $("td.menu_head", $currentRow).text();

			// "Essen X" for Monday, Tuesday, Wednesday etc.
			var mealIdDuringDays: { [dayOfWeek: number]: IMealItem } = {};

			var $tds = $("td", $currentRow);
			var $tdsBeneath = $("td", $rowBeneath);

			for(var dayOfWeek = 1; dayOfWeek <= 5; ++dayOfWeek)
			{
				var tdChildId = dayOfWeek + 1;
				// TODO: Better indexing
				var $td = $("td.menu_content:nth-child(" + tdChildId + ")", $currentRow);
				var $tdBeneath = $("td.menu_content:nth-child(" + tdChildId + ")", $rowBeneath);

				// Geschwenkte Kartoffel-Paprika-Pfanne mit Wasabisauce
				var currentMealName = $td.text();

				// Geschwenkte Kartoffel-Paprika-Pfanne mit Wasabisauce
				var realMealName = UniKasselParser.sanitizeMealName(currentMealName);

				// (1, 3, 9a) (V), Kcal:718, E:28.0 g, K:98.0 g, Fe:22.0 g
				var zsnamen = $(".zsnamen", $td).text()
				// [1, 3, 9a, 30, 35, V]
				var attr = UniKasselParser.getMealAttributes(zsnamen);

				var price = UniKasselParser.parseMealPrice($tdBeneath.text());

				var isVital = $td.hasClass("mensavital");
				var vitalInfo = isVital ? UniKasselParser.parseMensaVital(zsnamen) : null;

				if(!realMealName && !price)
				{
					mealIdDuringDays[dayOfWeek] = null;
				}
				else
				{
					mealIdDuringDays[dayOfWeek] = {
						name: realMealName,
						attributes: attr || [],
						price: price,
						vitalInfo: vitalInfo
					};
				}
			}
			meals[genericMealName] = mealIdDuringDays;
		}
		return meals;
	}

	private static parseMensaVital(zsnamen: string): IMensaVitalItem
	{
		//Kcal:718, E:28.0 g, K:98.0 g, Fe:22.0 g
		var calories = /Kcal:\s*([-+]?[0-9]*\.?[0-9]+)/im;
		var protein = /E:\s*([-+]?[0-9]*\.?[0-9]+)/im;
		var carbohydrate = /K:\s*([-+]?[0-9]*\.?[0-9]+)/im;
		var fat = /Fe:\s*([-+]?[0-9]*\.?[0-9]+)/im;
		return {
			fat: parseFloat(fat.exec(zsnamen)[1]),
			carbohydrate: parseFloat(carbohydrate.exec(zsnamen)[1]),
			protein: parseFloat(protein.exec(zsnamen)[1]),
			calories: parseFloat(calories.exec(zsnamen)[1]),
		};
	}

	private static parseMealPrice(text: string): IPriceItem
	{
		if(!text || !text.trim())
			return null;

		text = text.replace(/€/gim, "")
					.replace(/,/gim, ".")
					.replace(/\s/gim, "")
					.replace(/\(.*?\)/gim, "");

		var tsplit = text.split("/");
		if(tsplit.length != 3)
		{
			console.error("Whoopsie. Invalid price?");
			console.error(text);
			return null;
		}

		return {
			student: parseFloat(tsplit[0]),
			employee: parseFloat(tsplit[1]),
			foreign: parseFloat(tsplit[2])
		}
	}

	private static sanitizeMealName(name: string) : string
	{
		if(!name)
			return "";
		name = name
				.replace(UniKasselParser._mealAttrRe, "")
				.replace(/(Kcal|E|K|Fe):\s*([-+]?[0-9]*\.?[0-9]+)/im, "")
				.replace(/\s{2,}/gim, " ")
				.replace(/\s,/gim, ",");
		return name.trim();
	}

	private static _mealAttrRe = /\((.*?)\)/gim;
	private static getMealAttributes(name: string): string[]
	{
		if(!name)
			return [];
		name = name.replace(/\s/gim, "");
		var m;
		var s = "";
		while((m = UniKasselParser._mealAttrRe.exec(name)) !== null)
		{
			if(!!m || m.length > 0)
				s += m[1] + ",";
		}
		s = s.substring(0, s.length - 1);
		s = s
			.replace(/\(/gim, ",")
			.replace(/\)/gim, ",")
			.replace(/,{2,}/gim, ",");
		return s.split(",").concat();
	}

	private parseValidityInterval(intervalStr: string): IMenuValidity
	{

		// "Speiseplan vom 08.09. bis 12.09.2014"
		var intervalReExec = /(\d+\.\d+\.\d*)\s*.*\s+(\d+\.\d+\.\d+)/gim.exec(intervalStr);

		// If parsing the date values failed, just use the current week as interval
		if(!intervalReExec || intervalReExec.length != 3)
		{
			return {
				from : moment().startOf("week").toDate(),
				until: moment().endOf("week").toDate()
			};
		}

		//08.09. -> 08.09.2014
		var fromSplit = intervalReExec[1].split(".");
		var untilSplit = intervalReExec[2].split(".");
		untilSplit[2] = untilSplit[2] || (new Date()).getFullYear().toString();
		fromSplit[2] = fromSplit[2] || untilSplit[2];

		var fromDate = moment(fromSplit.join("."), "DD.MM.YYYY").toDate();
		var untilDate = moment(untilSplit.join("."), "DD.MM.YYYY").toDate();

		return {
			from : fromDate,
			until: untilDate
		};
	}

	private fixDateOffset(d: Date): Date
	{
		d.setHours(d.getHours() - d.getTimezoneOffset() / 60);
		return d;
	}
}

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
				name: "Mensa Menzelstraße"
			},
			url: "http://www.studentenwerk-kassel.de/195.html",
			parser: new UniKasselParser(),
			mealCount: 2 /* actually there are more, but they don't get used */
		},
		plett: {
			info: {
				name: "Mensa Heinrich-Plett-Straße"
			},
			url: "http://www.studentenwerk-kassel.de/187.html",
			parser: new UniKasselParser(),
			mealCount: 4
		},
		witzenhausen: {
			info: {
				name: "Mensa Witzenhausen"
			},
			url: "http://www.studentenwerk-kassel.de/415.html",
			parser: new UniKasselParser(),
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

var server = restify.createServer();

server.name = "canteen";
server.version = "1.0.0";
server.url = process.env["npm_package_config_url"] || "http://canteen.holz.nu";
var port = parseInt(process.env["PORT"]) || parseInt(process.env["npm_package_config_port"]) || 80;

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
