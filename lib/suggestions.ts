export const INVENTORY_NAME_SUGGESTIONS = [
  "Banquet chair",
  "VIP chair",
  "Round table",
  "Rectangular table",
  "White tablecloth",
  "Colored tablecloth",
  "Chair cover",
  "Carpet",
  "Stage platform",
  "Dance floor",
  "Stage truss",
  "LED panel",
  "Moving head light",
  "Tube light",
  "Speaker",
  "Audio mixer",
  "Wireless microphone",
  "Projector",
  "Projector screen",
  "Extension cable",
  "Power strip",
  "Distribution board",
  "Generator",
  "Electric fan",
  "Air cooler",
  "Room heater",
  "Floral backdrop",
  "Balloon decoration",
  "Banner and standee",
  "Roll-up banner",
  "Fire extinguisher",
  "First aid box",
  "Emergency light",
  "Dustbin",
  "Mop and bucket",
  "Ladder",
  "Tool box",
  "Buffet counter",
  "Dining table",
  "Beverage station",
  "Glass plates",
  "Steel dishes",
  "Cutlery set",
  "Water dispenser",
  "Umbrella stand",
  "Photo booth",
] as const;

export const SERVICE_NAME_SUGGESTIONS = [
  "Event planning",
  "Tent setup",
  "Event decoration",
  "Floral design",
  "Catering",
  "Stage and lighting",
  "DJ and sound",
  "Live band",
  "Photography",
  "Videography",
  "Drone photography",
  "MC and hosting",
  "Seating and tables",
  "Transportation",
  "Event security",
  "Custom theme",
] as const;

/**
 * Units a service can be sold in. The form renders these as "per {label}", so
 * every entry is a single noun the customer already understands, with no leading
 * "per" and no number in it.
 *
 * The list started at eight and covered the obvious ones — setup, item, hour,
 * day, guest — which left an admin pricing a three-day function or a week of
 * equipment hire typing a free-text label, and a free-text label is what the rest
 * of the quote then reads back as ("per 3 day setup"). It now covers the units an
 * events business actually quotes in: time (hour, day, session, shift, week,
 * month), headcount and catering (guest, plate, table), one-off jobs (setup,
 * flat, function, project), drawn volume and measure (metre, square foot),
 * counted stock (item, set, kit, box, pair, lot), and hire (trip, night).
 *
 * The field also accepts a unit that is not on this list — see
 * `SearchableSelect`'s `allowCustomValue` — because a closed list would send the
 * admin back to a free-text box for "per batch" or "per crew".
 */
export const UNIT_LABEL_SUGGESTIONS = [
  // Time and duration.
  "hour",
  "session",
  "shift",
  "day",
  "night",
  "week",
  "weekend",
  "month",
  // People and catering.
  "guest",
  "plate",
  "table",
  // One-off jobs, most of which are quoted as a flat fee.
  "setup",
  "flat",
  "service",
  "function",
  "project",
  "show",
  // Measure and drawn volume.
  "metre",
  "square foot",
  // Counted stock and hire.
  "item",
  "unit",
  "set",
  "kit",
  "box",
  "pair",
  "lot",
  "trip",
  "package",
] as const;

/**
 * The unit list as picker options. A price is read back everywhere as
 * "per {label}", so the label and the stored value are the same bare unit.
 */
export const UNIT_LABEL_OPTIONS = UNIT_LABEL_SUGGESTIONS.map((label) => ({ label, value: label }));

export const PACKAGE_NAME_SUGGESTIONS = [
  "Essential Celebration",
  "Signature Wedding",
  "Premium Wedding",
  "Birthday Sparkle",
  "Corporate Launch",
  "Private Party",
  "Intimate Gathering",
  "Full-Service Event",
] as const;

export const EVENT_LOCATION_SUGGESTIONS = [
  "Banquet hall",
  "Wedding venue",
  "Hotel ballroom",
  "Farmhouse",
  "Garden venue",
  "Home",
  "Office",
  "Outdoor venue",
  "Community hall",
] as const;
