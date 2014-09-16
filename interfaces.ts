// TODO: Documentation/JSDoc

interface IMenuValidity
{
	from: Date;
	until: Date;
}

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
	getCurrentMenu(cb: (err: Error, data: ICanteenMenu) => void): void;
	refresh(cb: (err: Error, data: ICanteenMenu) => void): void;
}

interface IParseResult
{
	success: boolean;
	message?: string;
	menu: ICanteenMenu;
}

interface ICanteenMenu
{
	info: ICanteenInfo;
	validity: IMenuValidity;
	currency: string;
	meals: IMeals;
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

interface ICanteenInfo
{
	name: string;
	locationDescription?: string;
	location?: { lat: number; long: number };
}

interface IMeals
{
	[genericName: string]: { [dayOfWeek: number]: IMealItem };
}

interface IMealItem
{
	name: string;
	//meatState: MeatState;
	attributes: string[]
	price: IPriceItem;
}

interface IPriceItem
{
	student: number;
	employee: number;
	foreign: number;
}
