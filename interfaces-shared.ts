
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
	attributes: string[]
	price: IPriceItem;
	vitalInfo: IMensaVitalItem;
}

interface IPriceItem
{
	student: number;
	employee: number;
	foreign: number;
}

interface ICanteenMenu
{
	info: ICanteenInfo;
	validity: IMenuValidity;
	currency: string;
	meals: IMeals;
}

interface IMensaVitalItem
{
	// Maybe add a units later
	protein: number;
	fat: number;
	calories: number;
	carbohydrate: number;
}

interface IMenuValidity
{
	from: Date;
	until: Date;
}

interface IParseResult
{
	success: boolean;
	message?: string;
	menu: ICanteenMenu;
}
