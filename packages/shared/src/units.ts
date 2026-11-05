/** The unit catalog behind the Metrics tab's Unit field — a categorized list
 * of measurement units a metric can carry. Transcribed from the project's
 * `Units.txt` reference (200 units / 27 categories).
 *
 * `metric.unit` is stored as the bare symbol string ("°C", "µg/m³"). The
 * field still accepts a custom typed value, so this list is a convenience,
 * not a constraint — `unitLabel` falls back to the raw string for any unit
 * not found here (older entries were free text).
 *
 * Some symbols repeat across categories (`%`, `ppm`, `°C`, `m`, `g`) — that's
 * expected; they mean different things in Humidity vs. Level vs. Efficiency.
 * `unitLabel`'s symbol lookup takes the first definition. */

export interface Unit {
  symbol: string;
  name: string;
}

export interface UnitCategory {
  category: string;
  units: Unit[];
}

export const UNIT_CATEGORIES: readonly UnitCategory[] = [
  {
    category: "Temperature",
    units: [
      { symbol: "°C", name: "Celsius" },
      { symbol: "°F", name: "Fahrenheit" },
      { symbol: "K", name: "Kelvin" },
      { symbol: "°R", name: "Rankine" },
    ],
  },
  {
    category: "Length",
    units: [
      { symbol: "µm", name: "Micrometer" },
      { symbol: "mm", name: "Millimeter" },
      { symbol: "cm", name: "Centimeter" },
      { symbol: "m", name: "Meter" },
      { symbol: "km", name: "Kilometer" },
      { symbol: "in", name: "Inch" },
      { symbol: "ft", name: "Foot" },
      { symbol: "yd", name: "Yard" },
      { symbol: "mi", name: "Mile" },
      { symbol: "nmi", name: "Nautical mile" },
    ],
  },
  {
    category: "Area",
    units: [
      { symbol: "mm²", name: "Square millimeter" },
      { symbol: "cm²", name: "Square centimeter" },
      { symbol: "m²", name: "Square meter" },
      { symbol: "km²", name: "Square kilometer" },
      { symbol: "ha", name: "Hectare" },
      { symbol: "ac", name: "Acre" },
      { symbol: "ft²", name: "Square foot" },
      { symbol: "yd²", name: "Square yard" },
    ],
  },
  {
    category: "Volume",
    units: [
      { symbol: "µL", name: "Microliter" },
      { symbol: "mL", name: "Milliliter" },
      { symbol: "L", name: "Liter" },
      { symbol: "cm³", name: "Cubic centimeter" },
      { symbol: "m³", name: "Cubic meter" },
      { symbol: "gal", name: "US gallon" },
      { symbol: "qt", name: "US quart" },
      { symbol: "pt", name: "US pint" },
      { symbol: "fl oz", name: "US fluid ounce" },
      { symbol: "ft³", name: "Cubic foot" },
      { symbol: "in³", name: "Cubic inch" },
    ],
  },
  {
    category: "Mass",
    units: [
      { symbol: "µg", name: "Microgram" },
      { symbol: "mg", name: "Milligram" },
      { symbol: "g", name: "Gram" },
      { symbol: "kg", name: "Kilogram" },
      { symbol: "t", name: "Metric ton" },
      { symbol: "oz", name: "Ounce" },
      { symbol: "lb", name: "Pound" },
      { symbol: "st", name: "Stone" },
    ],
  },
  {
    category: "Time",
    units: [
      { symbol: "µs", name: "Microsecond" },
      { symbol: "ms", name: "Millisecond" },
      { symbol: "s", name: "Second" },
      { symbol: "min", name: "Minute" },
      { symbol: "h", name: "Hour" },
      { symbol: "d", name: "Day" },
      { symbol: "wk", name: "Week" },
      { symbol: "mo", name: "Month" },
      { symbol: "yr", name: "Year" },
    ],
  },
  {
    category: "Speed",
    units: [
      { symbol: "m/s", name: "Meters per second" },
      { symbol: "km/h", name: "Kilometers per hour" },
      { symbol: "mph", name: "Miles per hour" },
      { symbol: "ft/s", name: "Feet per second" },
      { symbol: "kn", name: "Knots" },
      { symbol: "RPM", name: "Revolutions per minute" },
    ],
  },
  {
    category: "Acceleration",
    units: [
      { symbol: "m/s²", name: "Meters per second squared" },
      { symbol: "g", name: "Standard gravity" },
      { symbol: "Gal", name: "Gal" },
    ],
  },
  {
    category: "Angle and Rotation",
    units: [
      { symbol: "°", name: "Degree" },
      { symbol: "rad", name: "Radian" },
      { symbol: "rev", name: "Revolution" },
      { symbol: "°/s", name: "Degrees per second" },
      { symbol: "rad/s", name: "Radians per second" },
      { symbol: "rad/s²", name: "Radians per second squared" },
    ],
  },
  {
    category: "Electrical",
    units: [
      { symbol: "V", name: "Volt" },
      { symbol: "mV", name: "Millivolt" },
      { symbol: "µV", name: "Microvolt" },
      { symbol: "A", name: "Ampere" },
      { symbol: "mA", name: "Milliampere" },
      { symbol: "µA", name: "Microampere" },
      { symbol: "Ω", name: "Ohm" },
      { symbol: "kΩ", name: "Kiloohm" },
      { symbol: "MΩ", name: "Megaohm" },
      { symbol: "S", name: "Siemens" },
      { symbol: "F", name: "Farad" },
      { symbol: "µF", name: "Microfarad" },
      { symbol: "H", name: "Henry" },
      { symbol: "C", name: "Coulomb" },
    ],
  },
  {
    category: "Frequency",
    units: [
      { symbol: "Hz", name: "Hertz" },
      { symbol: "kHz", name: "Kilohertz" },
      { symbol: "MHz", name: "Megahertz" },
      { symbol: "GHz", name: "Gigahertz" },
    ],
  },
  {
    category: "Power",
    units: [
      { symbol: "W", name: "Watt" },
      { symbol: "mW", name: "Milliwatt" },
      { symbol: "kW", name: "Kilowatt" },
      { symbol: "MW", name: "Megawatt" },
      { symbol: "GW", name: "Gigawatt" },
      { symbol: "VA", name: "Volt-ampere" },
      { symbol: "kVA", name: "Kilovolt-ampere" },
      { symbol: "var", name: "Reactive power" },
    ],
  },
  {
    category: "Energy",
    units: [
      { symbol: "J", name: "Joule" },
      { symbol: "kJ", name: "Kilojoule" },
      { symbol: "MJ", name: "Megajoule" },
      { symbol: "Wh", name: "Watt-hour" },
      { symbol: "kWh", name: "Kilowatt-hour" },
      { symbol: "MWh", name: "Megawatt-hour" },
      { symbol: "cal", name: "Calorie" },
      { symbol: "kcal", name: "Kilocalorie" },
      { symbol: "BTU", name: "British thermal unit" },
    ],
  },
  {
    category: "Pressure",
    units: [
      { symbol: "Pa", name: "Pascal" },
      { symbol: "kPa", name: "Kilopascal" },
      { symbol: "MPa", name: "Megapascal" },
      { symbol: "hPa", name: "Hectopascal" },
      { symbol: "bar", name: "Bar" },
      { symbol: "mbar", name: "Millibar" },
      { symbol: "atm", name: "Standard atmosphere" },
      { symbol: "psi", name: "Pounds per square inch" },
      { symbol: "mmHg", name: "Millimeters of mercury" },
    ],
  },
  {
    category: "Humidity and Moisture",
    units: [
      { symbol: "%RH", name: "Relative humidity" },
      { symbol: "g/m³", name: "Absolute humidity" },
      { symbol: "g/kg", name: "Specific humidity" },
      { symbol: "°C", name: "Dew point" },
      { symbol: "%", name: "Soil moisture" },
      { symbol: "m³/m³", name: "Volumetric water content" },
    ],
  },
  {
    category: "Light and Radiation",
    units: [
      { symbol: "lx", name: "Illuminance" },
      { symbol: "lm", name: "Luminous flux" },
      { symbol: "cd", name: "Luminous intensity" },
      { symbol: "W/m²", name: "Irradiance" },
      { symbol: "UVI", name: "UV Index" },
      { symbol: "Sv", name: "Radiation dose equivalent" },
      { symbol: "µSv/h", name: "Radiation dose rate" },
    ],
  },
  {
    category: "Sound and Acoustics",
    units: [
      { symbol: "dB", name: "Sound pressure level" },
      { symbol: "dBA", name: "A-weighted sound level" },
      { symbol: "W/m²", name: "Sound intensity" },
    ],
  },
  {
    category: "Flow",
    units: [
      { symbol: "L/min", name: "Liters per minute" },
      { symbol: "L/h", name: "Liters per hour" },
      { symbol: "m³/h", name: "Cubic meters per hour" },
      { symbol: "m³/s", name: "Cubic meters per second" },
      { symbol: "GPM", name: "Gallons per minute" },
      { symbol: "GPH", name: "Gallons per hour" },
      { symbol: "kg/s", name: "Mass flow rate" },
    ],
  },
  {
    category: "Level",
    units: [
      { symbol: "%", name: "Percentage level" },
      { symbol: "mm", name: "Millimeter level" },
      { symbol: "cm", name: "Centimeter level" },
      { symbol: "m", name: "Meter level" },
    ],
  },
  {
    category: "Force and Mechanics",
    units: [
      { symbol: "N", name: "Newton" },
      { symbol: "kN", name: "Kilonewton" },
      { symbol: "lbf", name: "Pound-force" },
      { symbol: "N·m", name: "Torque" },
      { symbol: "kgf", name: "Kilogram-force" },
    ],
  },
  {
    category: "Vibration",
    units: [
      { symbol: "mm/s", name: "Vibration velocity" },
      { symbol: "m/s²", name: "Vibration acceleration" },
      { symbol: "µm", name: "Vibration displacement" },
      { symbol: "g", name: "Peak acceleration" },
    ],
  },
  {
    category: "Air Quality and Gas",
    units: [
      { symbol: "ppm", name: "Carbon dioxide" },
      { symbol: "ppm", name: "Carbon monoxide" },
      { symbol: "ppm", name: "Methane" },
      { symbol: "ppb", name: "Volatile organic compounds" },
      { symbol: "µg/m³", name: "Particulate matter PM1.0" },
      { symbol: "µg/m³", name: "Particulate matter PM2.5" },
      { symbol: "µg/m³", name: "Particulate matter PM10" },
      { symbol: "%", name: "Oxygen concentration" },
      { symbol: "ppb", name: "Ozone concentration" },
      { symbol: "ppb", name: "Nitrogen dioxide" },
      { symbol: "AQI", name: "Air Quality Index" },
    ],
  },
  {
    category: "Water Quality",
    units: [
      { symbol: "pH", name: "pH" },
      { symbol: "NTU", name: "Turbidity" },
      { symbol: "µS/cm", name: "Electrical conductivity" },
      { symbol: "ppm", name: "Total dissolved solids" },
      { symbol: "PSU", name: "Salinity" },
      { symbol: "mg/L", name: "Dissolved oxygen" },
      { symbol: "mV", name: "Oxidation reduction potential" },
    ],
  },
  {
    category: "Soil and Agriculture",
    units: [
      { symbol: "°C", name: "Soil temperature" },
      { symbol: "pH", name: "Soil pH" },
      { symbol: "mS/cm", name: "Soil conductivity" },
      { symbol: "%", name: "Leaf wetness" },
      { symbol: "mm", name: "Rainfall" },
      { symbol: "mm/h", name: "Rain rate" },
    ],
  },
  {
    category: "Location and Navigation",
    units: [
      { symbol: "°", name: "Latitude" },
      { symbol: "°", name: "Longitude" },
      { symbol: "m", name: "Altitude" },
      { symbol: "m", name: "GPS accuracy" },
      { symbol: "°", name: "Heading" },
      { symbol: "°", name: "Bearing" },
    ],
  },
  {
    category: "Industrial and Process",
    units: [
      { symbol: "%", name: "Percentage" },
      { symbol: "ppm", name: "Parts per million" },
      { symbol: "ppb", name: "Parts per billion" },
      { symbol: "count", name: "Count" },
      { symbol: "pulse", name: "Pulse" },
      { symbol: "event", name: "Event" },
      { symbol: "cycle", name: "Cycle" },
      { symbol: "item", name: "Item" },
      { symbol: "items/min", name: "Production rate" },
      { symbol: "%", name: "Efficiency" },
    ],
  },
  {
    category: "Data and Computing",
    units: [
      { symbol: "B", name: "Byte" },
      { symbol: "KB", name: "Kilobyte" },
      { symbol: "MB", name: "Megabyte" },
      { symbol: "GB", name: "Gigabyte" },
      { symbol: "TB", name: "Terabyte" },
      { symbol: "bps", name: "Bits per second" },
      { symbol: "kbps", name: "Kilobits per second" },
      { symbol: "Mbps", name: "Megabits per second" },
      { symbol: "Gbps", name: "Gigabits per second" },
      { symbol: "packet", name: "Packet" },
      { symbol: "%", name: "Packet loss" },
      { symbol: "ms", name: "Latency" },
      { symbol: "%", name: "CPU utilization" },
      { symbol: "%", name: "Memory utilization" },
      { symbol: "dBm", name: "Signal strength" },
    ],
  },
];

const NAME_BY_SYMBOL: ReadonlyMap<string, string> = new Map(
  // Reverse order so the first-listed category wins on a duplicate symbol.
  [...UNIT_CATEGORIES].reverse().flatMap((c) => c.units.map((u) => [u.symbol, u.name] as const)),
);

/** Human-friendly form of a stored unit symbol — `"°C — Celsius"` for a
 * catalog unit, the raw string for anything not in the catalog (older
 * free-text entries), `""` for null/blank. Safe to call anywhere a unit is
 * displayed. */
export function unitLabel(symbol: string | null | undefined): string {
  if (!symbol) return "";
  const name = NAME_BY_SYMBOL.get(symbol);
  return name ? `${symbol} — ${name}` : symbol;
}

/** Filter the catalog by a case-insensitive substring match on either the
 * symbol or the name. Preserves catalog order; drops categories with no
 * match. An empty query returns every category. */
export function searchUnits(query: string): UnitCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...UNIT_CATEGORIES];
  const out: UnitCategory[] = [];
  for (const category of UNIT_CATEGORIES) {
    const units = category.units.filter(
      (u) => u.symbol.toLowerCase().includes(q) || u.name.toLowerCase().includes(q),
    );
    if (units.length > 0) out.push({ category: category.category, units });
  }
  return out;
}
