import md from "./network.md?raw";
import { parseHomeNetwork } from "@/data/homeNetwork";

export const network = parseHomeNetwork(md);
