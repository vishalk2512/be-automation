export const targetClickedByLocator = async ({ page, target }) => {
    const targetSelector = await page.locator(target)
    await targetSelector.wait()
    await targetSelector.click()
}

export const inputTargetFilledByLocator = async ({ page, target, value }) => {
    const targetSelector = await page.locator(target)
    await targetSelector.wait()
    await targetSelector.fill(value)
}


export const targetClickedBySelector = async ({ page, target, timeout = 30000 }) => {
    await page.waitForSelector(target, { timeout })
    await page.click(target)
}

export const delay = async (ms = 1000) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

export const waitForNetworkIdleAndBuffer = async ({ page, idleTime = 1000, timeout = 30000, bufferDelay }) => {
    await page.waitForNetworkIdle({ idleTime, timeout })
    await delay(bufferDelay)
}

