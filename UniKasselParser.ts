///<reference path="typings/cheerio/cheerio.d.ts"/>
///<reference path="typings/moment/moment.d.ts"/>

///<reference path="./interfaces.ts"/>
///<reference path="./interfaces-shared.ts"/>

import cheerio = require("cheerio");
import moment = require("moment");

import ParseUtilities = require("./ParseUtilities");

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
					from: ParseUtilities.fixDateOffset(validity.from),
					until: ParseUtilities.fixDateOffset(validity.until)
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
				.replace(/\s{2,}/gim, " ")
				.replace(/\s,/gim, ",");
		if(name.lastIndexOf("Kcal") > -1)
			name = name.substring(0, name.lastIndexOf("Kcal"));
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
		s = s.substring(0, s.length - 1).toUpperCase();
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
}

export = UniKasselParser;
