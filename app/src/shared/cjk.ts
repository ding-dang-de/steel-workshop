/** 输入是否含中文/全角标点（这些字符不能作键名，只作查询） */
export function hasCjk(s: string): boolean {
  return /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/.test(s)
}
