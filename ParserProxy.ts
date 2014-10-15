///<reference path="typings/moment/moment.d.ts"/>

import moment = require("moment");

import MenuSystem = require("./Menu");

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
		MenuSystem.Menu.pull(this.canteen, (err, menu) => cb(err, menu));
	}
}

export = ParserProxy;
