import { getChromium } from "../../src/core/browser/playwright-loader";

const chromium = await getChromium();
console.log(typeof chromium.launch);
