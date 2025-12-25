import { inputTargetFilledByLocator, targetClickedByLocator } from './utils.js'

const handleCaptcha = async (page) => {
  const captchaInput = await page.locator('input[name="captchaInput"]')
  await captchaInput.wait()
  console.log('⚠️ Please solve the CAPTCHA manually in the browser...')
  await page.waitForFunction(() => {
    const el = document.querySelector('input[name="captchaInput"]')
    return el && el.value.length >= 5
  })
  console.log('✅ CAPTCHA solved')
}

export const login = async ({ page, username = '', password = '' }) => {
  await targetClickedByLocator({ page, target: 'a.login-btn' })

  await page.waitForFunction(() => {
    return window.location.href.includes('/portal/#/login')
  })

  await new Promise((r) => setTimeout(r, 500))
  await inputTargetFilledByLocator({
    page,
    target: 'input[name="username"]',
    value: username,
  })
  await new Promise((r) => setTimeout(r, 500))
  await inputTargetFilledByLocator({
    page,
    target: 'input[name="password"]',
    value: password,
  })

  await handleCaptcha(page)

  await targetClickedByLocator({ page, target: 'button[type="submit"]' })

  await page.waitForFunction(() => {
    return window.location.href.includes('/portal/#/portal')
  })
  console.log('✅ Successfully login', page.url())
}
