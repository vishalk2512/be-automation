import fs from 'fs/promises'

import { checkforValidString } from './utils.js'
import { URL, USERNAME, PASSWORD } from './config.js'
import { openUrlInBrowser } from './automation/browser.js'
import { login } from './automation/login.js'
import {
  targetClickedBySelector,
  waitForNetworkIdleAndBuffer,
} from './automation/utils.js'
import { JobContext } from './jobContext.js'

const goHome = async (page) => {
  await targetClickedBySelector({ page, target: 'nav a.logo img' })
  await waitForNetworkIdleAndBuffer({ page })
}

const runAutomation = async ({ page, data }) => {
  // Wait for initial page load/network activity to settle
  try {
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
  } catch (e) {
    console.log('Network idle timeout (proceeding anyway)')
  }
  // Extra safety wait for Angular to initialize
  await new Promise((r) => setTimeout(r, 2000))

  for (const item of data) {
    if (JobContext.isStopRequested()) {
      console.log('🛑 Stop requested. Aborting automation loop.')
      break
    }
    try {
      console.log('Processing item:', item.id)

      // Validate status
      if (item.status !== 'PENDING') {
        console.log('Skipping item due to status not PENDING:', item.id)
        continue
      }

      // Validate name and contact
      if (
        !checkforValidString(item.name) &&
        !checkforValidString(item.contact)
      ) {
        console.log('Skipping item due to empty name and contact:', item.id)
        item.status = 'ERROR'
        item.message = 'Empty name and contact'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      // wait for 1 second
      await new Promise((r) => setTimeout(r, 1000))

      // wait for name input to be visible
      await page.waitForSelector('input[name="name"]', { visible: true })

      // Fill in the name (simulate typing for Angular)
      await page.focus('input[name="name"]')
      // Clear input first
      await page.click('input[name="name"]', { clickCount: 3 })
      await page.keyboard.press('Backspace')

      await page.keyboard.type(item.name, { delay: 100 })
      await page.evaluate(() => {
        const el = document.querySelector('input[name="name"]')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
      console.log('✅ Name filled')

      // wait for contact input to be visible
      await page.waitForSelector('input[name="contact"]', { visible: true })

      // Fill in the contact (simulate typing for Angular)
      await page.focus('input[name="contact"]')
      // Clear input first
      await page.click('input[name="contact"]', { clickCount: 3 })
      await page.keyboard.press('Backspace')

      await page.keyboard.type(item.contact, { delay: 100 })
      await page.evaluate(() => {
        const el = document.querySelector('input[name="contact"]')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
      console.log('✅ Contact filled')

      await new Promise((r) => setTimeout(r, 500)) // Wait before clicking search

      // Click on the search button
      const searchBtn = await page.locator('button#invSearch')
      await searchBtn.wait()
      await searchBtn.click()
      console.log('✅ Search button clicked')

      // Wait for the search API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Wait for search results (either "No results" text OR a generic result card)
      try {
        await page.waitForFunction(
          () => {
            const noResultText = document.querySelector(
              'app-search-results-web div div'
            ).innerText
            const hasNoResults = noResultText.includes(
              'No results found matching your search.'
            )
            const hasCards =
              document.querySelectorAll(
                'app-search-results-web .container div mat-card div div div h3'
              ).length > 0
            return hasNoResults || hasCards
          },
          { timeout: 30000 }
        )
      } catch (e) {
        console.log(
          'Timeout waiting for search results (Check network or selectors)'
        )
        item.status = 'ERROR'
        item.message = 'Timeout waiting for search results'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      // Check current DOM state
      const searchState = await page.evaluate(() => {
        const noResultText = document.querySelector(
          'app-search-results-web div div'
        ).innerText
        const isNoResult = noResultText.includes(
          'No results found matching your search.'
        )

        const cards = Array.from(
          document.querySelectorAll(
            'app-search-results-web .container div mat-card div div div h3'
          )
        )

        return { isNoResult, count: cards.length }
      })

      if (searchState.isNoResult) {
        console.log('❌ Skipping: No results found matching your search.')
        item.status = 'ERROR'
        item.message = 'No results found matching your search.'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      if (searchState.count !== 1) {
        console.log(
          `⚠️ Skipping: No result or Multiple results found (${searchState.count})`
        )
        item.status = 'ERROR'
        item.message = `No result or Multiple results found (${searchState.count})`
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      const singleResult = await page.locator(
        'app-search-results-web .container div mat-card div div div h3'
      )
      await singleResult.click()
      console.log('✅ Clicked on result')

      // Wait for the search API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Check for Screening(SHC) tab
      const isScreeningTabHere = await page.evaluate(() => {
        const tabs = Array.from(
          document.querySelectorAll(
            "mat-tab-group mat-tab-header div div[role='tablist'] div div[role='tab'] div"
          )
        )
        const screeningTab = tabs.find(
          (el) => el.innerText.trim() === 'Screening(SHC)'
        )
        return !!screeningTab
      })

      if (!isScreeningTabHere) {
        console.log('⚠️ Skipping: "Screening(SHC)" tab not found')
        item.status = 'ERROR'
        item.message = 'Screening(SHC) tab not found'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      console.log('✅ Found "Screening(SHC)" tab. Clicking...')
      await page.evaluate(() => {
        const tabs = Array.from(
          document.querySelectorAll(
            "mat-tab-group mat-tab-header div div[role='tablist'] div div[role='tab'] div"
          )
        )
        const screeningTab = tabs.find(
          (el) => el.innerText.trim() === 'Screening(SHC)'
        )
        if (screeningTab) screeningTab.click()
      })
      console.log('✅ Clicked on "Screening(SHC)" tab')

      // Wait for the API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Check for "Hypertension"
      const isHypertensionFound = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('div mat-card div figure figcaption span')
        )
        const hypertensionSpan = spans.find(
          (el) => el.innerText.trim() === 'Hypertension'
        )
        return !!hypertensionSpan
      })

      if (!isHypertensionFound) {
        console.log('⚠️ Skipping: "Hypertension" tab not found')
        item.status = 'ERROR'
        item.message = 'Hypertension tab not found'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      console.log('✅ Found "Hypertension". Clicking...')
      await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('div mat-card div figure figcaption span')
        )
        const hypertensionSpan = spans.find(
          (el) => el.innerText.trim() === 'Hypertension'
        )
        if (hypertensionSpan) hypertensionSpan.click()
      })
      console.log('✅ Clicked on "Hypertension"')

      // Wait for the API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      const days = [13, 14, 15, 16, 17]
      const randomDay = days[Math.floor(Math.random() * days.length)]
      // Handle datePicker1
      const dateSelector =
        'form div span mat-form-field div div div input[name="datePicker1"]'
      // Wait for it to be present in DOM
      try {
        await page.waitForSelector(dateSelector, { timeout: 30000 })

        const isDisabled = await page.$eval(dateSelector, (el) => el.disabled)

        if (isDisabled) {
          console.log('ℹ️ Date picker is disabled. Proceeding ahead.')
        } else {
          console.log(
            '✅ Date picker is active. Selecting 10-07-2025 via UI...'
          )

          // 1. Click the toggle button
          const toggleBtnSelector =
            'mat-form-field div div div mat-datepicker-toggle button'
          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))

          // 2. Click "Previous month" twice
          const prevMonthSelector1 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          const prevMonthSelector2 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation

          // 3. Click the specific date
          // Randomly select a date between 13, 14, 15, 16, 17
          const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="October ${randomDay}, 2025"]`
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log('✅ Date selected via UI')

          // Handle radio button (Text "No")
          try {
            const foundRadio = await page.evaluate(() => {
              const spans = Array.from(
                document.querySelectorAll(
                  'div div div mat-radio-group mat-radio-button label span.mat-radio-label-content'
                )
              )
              // Fallback to strict structure if class not found: 'div div div mat-radio-group mat-radio-button label span span'
              // Searching broadly within radio buttons for "No"
              const target = spans.find((el) => el.innerText.trim() === 'No')
              if (target) {
                target.click()
                return true
              }
              // Fallback strategy if specific class not found
              const broadSpans = Array.from(
                document.querySelectorAll('mat-radio-button label span')
              )
              const broadTarget = broadSpans.find(
                (el) => el.innerText.trim() === 'No'
              )
              if (broadTarget) {
                broadTarget.click()
                return true
              }
              return false
            })

            if (foundRadio) {
              console.log('✅ Clicked radio button ("No")')
            } else {
              console.log('⚠️ Radio button "No" not found')
            }
          } catch (e) {
            console.log('⚠️ Radio button error:', e.message)
          }

          await new Promise((r) => setTimeout(r, 500))

          // Save and Exit
          try {
            const saveExitSelector = 'mat-card button[id="savenexit"]'
            await page.waitForSelector(saveExitSelector, { timeout: 30000 })
            await page.click(saveExitSelector)
            console.log('✅ Clicked "Save & Exit"')

            await new Promise((r) => setTimeout(r, 500))

            // Confirm Dialog (2nd button)
            const dialogBtnSelector =
              'mat-dialog-container mat-dialog-actions div button:nth-child(1)'
            await page.waitForSelector(dialogBtnSelector, { timeout: 30000 })
            await page.click(dialogBtnSelector)
            console.log('✅ Clicked Confirmation Dialog Button')
          } catch (e) {
            console.log('⚠️ Save/Dialog error:', e.message)
          }
        }
      } catch (e) {
        console.log('⚠️ Date picker not found or error:', e.message)
        // Not treating as fatal error, proceeding
      }

      // Wait for the API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Check for "Diabetes"
      const isDiabetesFound = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('div mat-card div figure figcaption span')
        )
        const diabetesSpan = spans.find((el) => el.innerText === 'Diabetes')
        return !!diabetesSpan
      })

      if (!isDiabetesFound) {
        console.log('⚠️ Skipping: "Diabetes" tab not found')
        item.status = 'ERROR'
        item.message = 'Diabetes tab not found'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      console.log('✅ Found "Diabetes". Clicking...')
      await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('div mat-card div figure figcaption span')
        )
        const diabetesSpan = spans.find((el) => el.innerText === 'Diabetes')
        if (diabetesSpan) diabetesSpan.click()
      })
      console.log('✅ Clicked on "Diabetes"')

      // Wait for the API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Handle datePicker1
      const dateSelectorForDiabetes =
        'form div span mat-form-field div div div input[name="datePicker1"]'
      // Wait for it to be present in DOM
      try {
        await page.waitForSelector(dateSelectorForDiabetes, { timeout: 30000 })

        const isDisabled = await page.$eval(
          dateSelectorForDiabetes,
          (el) => el.disabled
        )

        if (isDisabled) {
          console.log('ℹ️ Date picker is disabled. Proceeding ahead.')
          item.status = 'COMPLETED'
          item.message = 'Successfully processed'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        } else {
          console.log(
            '✅ Date picker is active. Selecting 10-07-2025 via UI...'
          )

          // 1. Click the toggle button
          const toggleBtnSelector =
            'mat-form-field div div div mat-datepicker-toggle button'
          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))

          // 2. Click "Previous month" twice
          const prevMonthSelector1 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          const prevMonthSelector2 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation

          // 3. Click the specific date
          // Randomly select a date between 13, 14, 15, 16, 17
          const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="October ${randomDay}, 2025"]`
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log('✅ Date selected via UI')

          // Handle radio button (Text "No")
          try {
            const foundRadio = await page.evaluate(() => {
              const spans = Array.from(
                document.querySelectorAll(
                  'div div div mat-radio-group mat-radio-button label span.mat-radio-label-content'
                )
              )
              // Fallback to strict structure if class not found: 'div div div mat-radio-group mat-radio-button label span span'
              // Searching broadly within radio buttons for "No"
              const target = spans.find((el) => el.innerText.trim() === 'No')
              if (target) {
                target.click()
                return true
              }
              // Fallback strategy if specific class not found
              const broadSpans = Array.from(
                document.querySelectorAll('mat-radio-button label span')
              )
              const broadTarget = broadSpans.find(
                (el) => el.innerText.trim() === 'No'
              )
              if (broadTarget) {
                broadTarget.click()
                return true
              }
              return false
            })

            if (foundRadio) {
              console.log('✅ Clicked radio button ("No")')
            } else {
              console.log('⚠️ Radio button "No" not found')
            }
          } catch (e) {
            console.log('⚠️ Radio button error:', e.message)
          }

          await new Promise((r) => setTimeout(r, 500))

          // Save and Exit
          try {
            const saveExitSelector = 'mat-card button[id="savenexit"]'
            await page.waitForSelector(saveExitSelector, { timeout: 30000 })
            await page.click(saveExitSelector)
            console.log('✅ Clicked "Save & Exit"')

            await new Promise((r) => setTimeout(r, 500))

            // Confirm Dialog (2nd button)
            const dialogBtnSelector =
              'mat-dialog-container mat-dialog-actions div button:nth-child(1)'
            await page.waitForSelector(dialogBtnSelector, { timeout: 30000 })
            await page.click(dialogBtnSelector)
            console.log('✅ Clicked Confirmation Dialog Button')
          } catch (e) {
            console.log('⚠️ Save/Dialog error:', e.message)
          }
        }
      } catch (e) {
        console.log('⚠️ Date picker not found or error:', e.message)
        // Not treating as fatal error, proceeding
      }

      // Wait for the API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 3000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      console.log('✅ Successfully processed item:', item.id)
      item.status = 'COMPLETED'
      item.message = 'Successfully processed'
      await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
      await goHome(page)
    } catch (error) {
      console.log('Error processing item:', item.id, error)
      return
    }
  }
}

export const runJob = async () => {
  JobContext.setStopRequested(false)
  try {
    const { page, browser } = await openUrlInBrowser({ url: URL })
    await login({ page, username: USERNAME, password: PASSWORD })

    // Read data from data.json
    const rawData = await fs.readFile('./data.json', 'utf8')
    const fileData = JSON.parse(rawData)
    console.log(`Loaded ${fileData.length} items from data.json`)

    await runAutomation({ page, data: fileData })
    await browser.close()
  } catch (error) {
    console.log('Error', error)
    throw error
  }
}
