///<reference path="./interfaces-shared.ts"/>

// TODO: Documentation/JSDoc

interface IMenuParser
{
	parse(canteen: ICanteenItem, response: string): IParseResult;
}

interface IParserProxy
{
	maxAge: number;
	canteen: string;
	/**
	 * Returns the age of the current caced plan in seconds.
	 */
	getMenuAge(): number;
	getCurrentMenu(cb: (err: Error, data: IParseResult) => void): void;
	refresh(cb: (err: Error, data: IParseResult) => void): void;
}

interface ICanteenList
{
	[key: string]: ICanteenItem;
}

interface ICanteenItem
{
	info: ICanteenInfo;
	url: string;
	parser: IMenuParser;
	mealCount: number;
	parserProxy?: IParserProxy;
}
