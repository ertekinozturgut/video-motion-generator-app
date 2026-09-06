/**
 * @supabase/ssr'nin setAll geri \u00e7a\u011f\u0131r\u0131m\u0131 parametre tipini \u00e7\u0131karm\u0131yor,
 * strict mod da bunu implicit any olarak reddediyor. Tipi tek yerde
 * tan\u0131mlay\u0131p hem server hem middleware'de kullan\u0131yoruz.
 */
export interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}
