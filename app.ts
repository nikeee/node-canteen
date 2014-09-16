///<reference path="typings/node/node.d.ts"/>
///<reference path="typings/cheerio/cheerio.d.ts"/>
///<reference path="typings/restify/restify.d.ts"/>
///<reference path="typings/request/request.d.ts"/>
///<reference path="typings/moment/moment.d.ts"/>

///<reference path="./interfaces.ts"/>

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
	private _currentMenu: ICanteenMenu = null;
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

	public getCurrentMenu(cb: (err: Error, data: ICanteenMenu) => void): void
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

	public refresh(cb: (err: Error, data: ICanteenMenu) => void): void
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
		var $tbody = $("body#essen table tbody");

		// "Speiseplan vom 08.09. bis 12.09.2014"
		var intervalStr = $("tr[valign=bottom] td strong", $tbody).text();
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

		for(var row = 0; row < numMeals; ++row)
		{
			var trChildId = offset + row * 2;
			var $currentRow = $("tr:nth-child(" + trChildId + ")", $tbody);
			var $rowBeneath = $("tr:nth-child(" + (trChildId + 1) + ")", $tbody);

			// "Essen 1", "Essen 2", "Essen 3 oder 4", "Angebot des Tages"
			var genericMealName = $("td.gelb strong.big2", $currentRow).text();

			// "Essen X" for Monday, Tuesday, Wednesday etc.
			var mealIdDuringDays: { [dayOfWeek: number]: IMealItem } = {};

			var $tds = $("td", $currentRow);
			var $tdsBeneath = $("td", $rowBeneath);

			for(var dayOfWeek = 1; dayOfWeek <= 5; ++dayOfWeek)
			{
				var tdChildId = dayOfWeek + 1;
				var $td = $("td:nth-child(" + tdChildId + ")", $currentRow);
				var $tdBeneath = $("td:nth-child(" + tdChildId + ")", $rowBeneath);

				// Geschwenkte Kartoffel-Paprika-Pfanne mit Wasabisauce (1,3,9a,30,35) (V)
				var currentMealName = $td.text();

				// Geschwenkte Kartoffel-Paprika-Pfanne mit Wasabisauce
				var realMealName = UniKasselParser.sanitizeMealName(currentMealName);

				// [1, 3, 9a, 30, 35, V]
				var attr = UniKasselParser.getMealAttributes(currentMealName);

				var price = UniKasselParser.parseMealPrice($tdBeneath.text());

				if(!realMealName && !price)
				{
					mealIdDuringDays[dayOfWeek] = null;
				}
				else
				{
					mealIdDuringDays[dayOfWeek] = {
						name: realMealName,
						attributes: attr || [],
						price: price
					};
				}
			}
			meals[genericMealName] = mealIdDuringDays;
		}
		return meals;
	}

	private static parseMealPrice(text: string) : IPriceItem
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
			console.debug("Whoopsie. Invalid price?");
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
		name = name.replace(UniKasselParser._mealAttrRe, "")
				.replace(/\s{2,}/gim, " ");
		return name.trim();
	}

	private static _mealAttrRe = /\((.*?)\)/gim;
	private static getMealAttributes(name: string): string[]
	{
		if(!name)
			return [];
		name = name.replace(/\s/gim, "");
		var m = UniKasselParser._mealAttrRe.exec(name);
		if(!m || m.length < 1)
			return [];
		return m[1].split(",");
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
	private static _availableCanteens: ICanteenList = {
		wilhelmshoehe: {
			info: {
				name: "Mensa Wilhelmshöher Allee"
			},
			url: "./html-data/1.html",/* "http://www.studentenwerk-kassel.de/189.html", */
			parser: new UniKasselParser(),
			mealCount: 4
		},
		hopla: {
			info: {
				name: "Zentralmensa Uni Kassel",
				locationDescription: "Holländischer Platz"
			},
			url: "./html-data/z1.html",/* "http://www.studentenwerk-kassel.de/188.html", */
			parser: new UniKasselParser(),
			mealCount: 6
		}
	};

	public static getOrRequestCached(canteen: string, cb: (err: Error, data: ICanteenMenu) => void) : void
	{
		if(!Menu._hasInit)
			Menu.init();
		if(!cb)
			cb = (e, d) => {};
		if(!canteen || typeof Menu._availableCanteens[canteen.toLowerCase()] === "undefined")
		{
			cb(new Error("Canteen not available"), null);
			return;
		}

		Menu._availableCanteens[canteen].parserProxy.getCurrentMenu((e, d) => cb(e, d));
	}

	private static _hasInit = false;
	private static init(): void
	{
		var maxAge = parseInt(process.env["npm_package_config_maxMenuAge"]);

		for(var key in Menu._availableCanteens)
		{
			Menu._availableCanteens[key].parserProxy = new ParserProxy(key, maxAge);
		}
		Menu._hasInit = true;
	}

	public static pull(canteen: string, cb: (err: Error, data: ICanteenMenu) => void) : void
	{
		if(!Menu._hasInit)
			Menu.init();

		if(!cb)
			cb = (e, d) => {};
		if(!canteen || typeof Menu._availableCanteens[canteen.toLowerCase()] === "undefined")
		{
			cb(new Error("Canteen not available"), null);
			return;
		}

		var canteenData = Menu._availableCanteens[canteen];

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

	private static handleBody(canteenData: ICanteenItem, body: string, cb: (err: Error, data: ICanteenMenu) => void) : void
	{
		var parseRes = canteenData.parser.parse(canteenData, body);
		if(!parseRes.success)
			return cb(new Error(parseRes.message || "Failed to parse menu."), null);
		cb(null, parseRes.menu);
	}
}

var server = restify.createServer();

server.name = "canteen";
server.version = "1.0.0";
server.url = process.env["npm_package_config_url"];

// TODO: Make better use of restify API.
server.on("uncaughtException", (request, response, route, error) => {
	console.error(route + ":\n");
	console.dir(error);

	response.send(500, {
		success: false,
		message: error
	});
});

server.get("/menu/:canteen", (req, res, next) => {

	// Definition fail. res.charSet(string) actually exists. The .d.ts file is wrong.
	// Ignore this compilation error.
	res.charSet("utf-8");

	console.log("Serving response.");

	// TODO: Cache Menu in RAM after startup
	// Pull a new version every 20 minutes
	// Serve cached version to clients
	Menu.getOrRequestCached(req.params.canteen, (err, menu) => {
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

server.listen(process.env["npm_package_config_port"], () => {
	console.log("%s listening at %s", server.name, server.url);
});
