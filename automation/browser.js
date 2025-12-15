import puppeteer from "puppeteer"

export const openUrlInBrowser = async ({ url = '' }) => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
    })

    const page = await browser.pages().then((pages) => pages[0])
    const response = await page.goto(url)
    console.log('✅ Successfully open URL in browser', response.url())
    return { page, browser }
}