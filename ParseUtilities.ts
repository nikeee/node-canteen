
class ParseUtilities
{
	public static fixDateOffset(d: Date): Date
	{
		d.setHours(d.getHours() - d.getTimezoneOffset() / 60);
		return d;
	}
}

export = ParseUtilities;
