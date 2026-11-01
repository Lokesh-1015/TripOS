// Marketing imagery, the landing page's illustrative crew, and static starter content.
import type { Person, Trip } from "./types";

export const img = (id: string, w = 1600) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const IMG = {
  manali: "photo-1597167231350-d057a45dc868",
  solang: "photo-1619344901057-d4dbeced24af",
  goa: "photo-1614082242765-7c98ca0f3df3",
  goaShore: "photo-1560094127-a6710fa2d266",
  goaDog: "photo-1639818658593-5d70eaaaa2ba",
  goaGroup: "photo-1655574515985-5ee58bc3ca5c",
  goaCouple: "photo-1699676124820-d383ef8b5aed",
  udaipur: "photo-1695956353120-54ce5e91632b",
  pichola: "photo-1633702738734-443da2c18f3c",
  hawaMahal: "photo-1477587458883-47145ed94245",
  jaipurFort: "photo-1603262110263-fb0112e7cc33",
  camel: "photo-1599475504246-11c1217748c2",
  camelTrail: "photo-1510952267577-fc96d5ca660a",
  ladakh: "photo-1593118845043-359e5f628214",
  pangong: "photo-1635255506105-b74adbd94026",
  keralaSunset: "photo-1624554305378-0f440dd3a8c1",
  kerala: "photo-1602216056096-3b40cc0c9944",
  rishikesh: "photo-1729922141827-ba9163bfb884",
  meghalaya: "photo-1685346388921-26dd3ae934be",
  meghalaya2: "photo-1637043765564-a071ff91a09f",
};

const av = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=160&h=160&q=80`;

export const ME: Person = { id: "u-me", name: "Ishita Kapoor", email: "ishita@tripos.app", avatar: av("photo-1534528741775-53994a69daeb") };
export const PEOPLE: Person[] = [
  ME,
  { id: "p-priya", name: "Priya Nair", email: "priya.nair@gmail.com", avatar: av("photo-1517841905240-472988babdf9") },
  { id: "p-rohan", name: "Rohan Mehta", email: "rohan.mehta@gmail.com", avatar: av("photo-1507003211169-0a1dd7228f2d") },
  { id: "p-ananya", name: "Ananya Joshi", email: "ananya.j@outlook.com", avatar: av("photo-1524504388940-b1c1722653e1") },
  { id: "p-kabir", name: "Kabir Singh", email: "kabir.singh@gmail.com", avatar: av("photo-1500648767791-00dcc994a43e") },
  { id: "p-vikram", name: "Vikram Rao", email: "vikram.rao@gmail.com", avatar: av("photo-1506794778202-cad84cf45f1d") },
];


const blankTrip = (): Omit<Trip, "id" | "name" | "destination" | "description" | "cover" | "startDate" | "endDate" | "members"> => ({
  flexibleDates: false, currency: "INR", budget: 0, perPersonBudget: 0, archived: false, createdAt: new Date().toISOString(),
  activities: [], expenses: [], settlements: [], tasks: [], packing: [], documents: [], places: [], messages: [], polls: [], photos: [], events: [], highlights: [],
});
export { blankTrip };

export const PACKING_TEMPLATES: { id: string; name: string; items: { name: string; category: Trip["packing"][number]["category"]; qty: number }[] }[] = [
  { id: "mountains", name: "Mountains & snow", items: [
    { name: "Thermal set", category: "clothing", qty: 2 }, { name: "Gloves", category: "clothing", qty: 1 }, { name: "Lip balm", category: "toiletries", qty: 1 },
    { name: "Hand warmers", category: "essentials", qty: 4 }, { name: "Altitude meds", category: "medicines", qty: 1 } ] },
  { id: "beach", name: "Beach weekend", items: [
    { name: "Swimwear", category: "clothing", qty: 2 }, { name: "Flip-flops", category: "clothing", qty: 1 }, { name: "Sunscreen", category: "toiletries", qty: 1 },
    { name: "Waterproof phone pouch", category: "electronics", qty: 1 }, { name: "Sunglasses", category: "essentials", qty: 1 } ] },
  { id: "intl", name: "International trip", items: [
    { name: "Passport", category: "documents", qty: 1 }, { name: "Visa printout", category: "documents", qty: 1 }, { name: "Universal adapter", category: "electronics", qty: 1 },
    { name: "Forex card", category: "documents", qty: 1 }, { name: "Neck pillow", category: "essentials", qty: 1 } ] },
];

