import fs from 'fs/promises'

import { checkforValidString } from './utils.js'
import { URL, USERNAME, PASSWORD } from './config.js'
import { openUrlInBrowser } from './automation/browser.js'
import { login } from './automation/login.js'
import {
  inputTargetFilledByLocator,
  targetClickedBySelector,
  waitForNetworkIdleAndBuffer,
} from './automation/utils.js'
import { JobContext } from './jobContext.js'

const goHome = async (page) => {
  console.log('Going home...')
  await targetClickedBySelector({
    page,
    target: 'nav div.pull-left a.logo img',
  })
  console.log('Waiting for network idle and buffer...')
  await waitForNetworkIdleAndBuffer({ page })
  console.log('Home reached')
}

const isFollowUp = true

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

      if (searchState.count === 0) {
        console.log(`⚠️ Skipping: No result`)
        item.status = 'ERROR'
        item.message = `No result`
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      if (searchState.count === 1) {
        const singleResult = await page.locator(
          'app-search-results-web .container div mat-card div div div h3'
        )
        await singleResult.click()
        console.log('✅ Clicked on result')
      } else {
        // Multiple results found - need to match by age and gender
        console.log(
          `🔍 Multiple results found (${searchState.count}). Matching by age and gender...`
        )

        const clicked = await page.evaluate(
          (itemAge, itemGender) => {
            // Get all result cards
            const cards = Array.from(
              document.querySelectorAll(
                'app-search-results-web .container div mat-card div div div.ml15'
              )
            )

            // Map gender code to full text
            const genderMap = {
              M: 'Male',
              F: 'Female',
            }
            const expectedGenderText = genderMap[itemGender] || itemGender

            // Find matching card and click on first span
            for (const card of cards) {
              // Get the paragraph element
              const pElement = card.querySelector('p')
              if (!pElement) {
                throw new Error('No paragraph element found')
              }

              // Check age match in paragraph innerText
              const pText = pElement.innerText || ''
              const userAge = Number(itemAge)
              const ageMatch =
                pText.includes(userAge) ||
                pText.includes(userAge + 1) ||
                pText.includes(userAge - 1) ||
                pText.includes(userAge + 2) ||
                pText.includes(userAge - 2)
              const genderMatch = pText.includes(expectedGenderText)

              if (ageMatch && genderMatch) {
                // Found match - click on the first span
                card.click()
                return true
              }
            }

            return false
          },
          item.age,
          item.gender
        )

        if (clicked) {
          console.log('✅ Clicked on matched result (age and gender matched)')
        } else {
          console.log('❌ No matching result found for age and gender')
          item.status = 'ERROR'
          item.message = `No matching result found for age ${item.age} and gender ${item.gender}`
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        }
      }

      // Wait for the search API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      if (isFollowUp) {
        // Check for Screening(SHC) tab
        const isFollowupTabHere = await page.evaluate(() => {
          const tabs = Array.from(
            document.querySelectorAll(
              "mat-tab-group mat-tab-header div div[role='tablist'] div div[role='tab'] div"
            )
          )
          const followupTab = tabs.find(
            (el) => el.innerText.trim() === 'Add Treatment/Follow-up'
          )
          return !!followupTab
        })

        if (!isFollowupTabHere) {
          console.log('⚠️ Skipping: "Add Treatment/Follow-up" tab not found')
          item.status = 'ERROR'
          item.message = 'Add Treatment/Follow-up tab not found'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        }

        console.log('✅ Found "Add Treatment/Follow-up" tab. Clicking...')
        await page.evaluate(() => {
          const tabs = Array.from(
            document.querySelectorAll(
              "mat-tab-group mat-tab-header div div[role='tablist'] div div[role='tab'] div"
            )
          )
          const followupTab = tabs.find(
            (el) => el.innerText.trim() === 'Add Treatment/Follow-up'
          )
          if (followupTab) followupTab.click()
        })

        try {
          await new Promise((r) => setTimeout(r, 500))

          const days = [1, 2, 3, 6, 7]
          const randomDay = days[Math.floor(Math.random() * days.length)]

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-04-2026 via UI...`
          )

          // 1. Click the toggle button
          const toggleBtnSelector =
            'mat-tab-body.mat-tab-body-active mat-form-field div div div mat-datepicker-toggle button'
          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))

          // Randomly select a date between 13, 14, 15, 16, 17
          const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="April ${randomDay}, 2026"]`
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-04-2026`)
        } catch (e) {
          console.log('Error selecting date:', e)
          item.status = 'ERROR'
          item.message = 'Error selecting date'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        }

        const systolicBloodPressureSelector =
          'mat-tab-body.mat-tab-body-active input[name="systolic"]'

        const isDisabled = await page.$eval(
          systolicBloodPressureSelector,
          (el) => el.disabled
        )

        if (isDisabled) {
          console.log('ℹ️ Inputs are disabled. Proceeding ahead.', item.id)
          item.status = 'ERROR'
          item.message = 'Inputs are disabled.'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await new Promise((r) => setTimeout(r, 5000))
          await goHome(page)
          continue
        }
        // Pick a random weight value between 100 and 120 (inclusive)
        const randomSystolic = (
          Math.floor(Math.random() * (120 - 100 + 1)) + 100
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: systolicBloodPressureSelector,
          value: randomSystolic,
        })

        await new Promise((r) => setTimeout(r, 500))

        const diastolicBloodPressureSelector =
          'mat-tab-body.mat-tab-body-active input[name="diastolic"]'
        // Pick a random weight value between 70 and 80 (inclusive)
        const randomDiastolic = (
          Math.floor(Math.random() * (80 - 70 + 1)) + 70
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: diastolicBloodPressureSelector,
          value: randomDiastolic,
        })

        await new Promise((r) => setTimeout(r, 500))

        const randomBloodSugarSelector =
          'mat-tab-body.mat-tab-body-active input[name="randomBloodGlucose"]'
        // Pick a random weight value between 95 and 115 (inclusive)
        const randomBloodSugar = (
          Math.floor(Math.random() * (115 - 95 + 1)) + 95
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: randomBloodSugarSelector,
          value: randomBloodSugar,
        })
        await new Promise((r) => setTimeout(r, 500))

        const attestationSelector =
          'mat-tab-body.mat-tab-body-active mat-checkbox[name="attestation"]'
        await page.waitForSelector(attestationSelector, { timeout: 30000 })
        await page.click(attestationSelector)
        console.log('✅ Clicked on attestation checkbox')

        await new Promise((r) => setTimeout(r, 500))

        const saveButtonSelector =
          'mat-tab-body.mat-tab-body-active button[type="submit"]'
        await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
        await page.click(saveButtonSelector)
        console.log('✅ Clicked on save button')

        await new Promise((r) => setTimeout(r, 3000))

        //cdk-overlay-container
        //<div class="cdk-overlay-container"><div class="cdk-global-overlay-wrapper" dir="ltr" style="justify-content: center; align-items: flex-start;"><div id="cdk-overlay-2" class="cdk-overlay-pane" style="position: static; margin-top: 0px;"><snack-bar-container class="mat-snack-bar-container ng-tns-c23-149 ng-trigger ng-trigger-state success mat-snack-bar-center mat-snack-bar-top ng-star-inserted" style="transform: scale(1); opacity: 1;"><div class="ng-tns-c23-149" aria-live="assertive"><div class="ng-tns-c23-149"><app-snackbar _nghost-qvo-c69="" class="ng-star-inserted"><div _ngcontent-qvo-c69=""><div _ngcontent-qvo-c69="" fxlayout="row" class="snack-container"><div _ngcontent-qvo-c69=""><mat-icon _ngcontent-qvo-c69="" role="img" class="mat-icon notranslate material-icons mat-ligature-font mat-icon-no-color" aria-hidden="true" data-mat-icon-type="font">done</mat-icon></div><div _ngcontent-qvo-c69="" class="pl10 success"><span _ngcontent-qvo-c69="">Treatment Saved Successfully!</span></div><span _ngcontent-qvo-c69=""><mat-icon _ngcontent-qvo-c69="" role="img" class="mat-icon notranslate cursor-pointer material-icons mat-ligature-font mat-icon-no-color ng-star-inserted" aria-hidden="true" data-mat-icon-type="font" style="">close</mat-icon><!----></span></div><!----></div></app-snackbar><!----></div></div></snack-bar-container></div></div></div>

        console.log('✅ Successfully processed item:', item.id)
        item.status = 'COMPLETED'
        item.message = 'Successfully processed'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await new Promise((r) => setTimeout(r, 5000))
        await goHome(page)
        continue
      }

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

      // Check for "Please complete CBAC to start screening." message
      const isCBACMessageFound = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span'))
        const cbacSpan = spans.find(
          (el) =>
            el.innerText.trim() === 'Please complete CBAC to start screening.'
        )
        return !!cbacSpan
      })

      if (isCBACMessageFound) {
        console.log(
          '✅ CBAC message found: "Please complete CBAC to start screening."'
        )

        try {
          await new Promise((r) => setTimeout(r, 500))

          const days = [22, 23, 24, 25, 26]
          const randomDay = days[Math.floor(Math.random() * days.length)]

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          // 1. Click the toggle button
          const toggleBtnSelector =
            'mat-tab-body.mat-tab-body-active mat-form-field div div div mat-datepicker-toggle button'
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

          const prevMonthSelector3 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation

          // 3. Click the specific date
          // Randomly select a date between 13, 14, 15, 16, 17
          const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="December ${randomDay}, 2025"]`
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          // Wait for and click on physicalDisablilitySelected mat-select
          await new Promise((r) => setTimeout(r, 500))
          const physicalDisabilitySelector =
            'mat-tab-body.mat-tab-body-active mat-select[name="physicalDisablilitySelected"]'
          await page.waitForSelector(physicalDisabilitySelector, {
            timeout: 30000,
          })
          await page.click(physicalDisabilitySelector)
          console.log('✅ Clicked on physicalDisablilitySelected mat-select')

          // Wait for listbox to appear and click on "None" option
          await new Promise((r) => setTimeout(r, 500))
          const noneOptionSelector =
            'div[role="listbox"] mat-option[value="None"]'
          await page.waitForSelector(noneOptionSelector, { timeout: 30000 })
          await page.click(noneOptionSelector)
          console.log('✅ Clicked on "None" option')

          // click on anypart of body to close the listbox
          await new Promise((r) => setTimeout(r, 500))
          await page.keyboard.press('Escape')
          console.log('✅ Pressed Escape key to close the listbox')

          // Wait for and click on patienthistorysmoking mat-select
          await new Promise((r) => setTimeout(r, 500))
          const smokingHistorySelector =
            'mat-tab-body.mat-tab-body-active mat-select[name="patienthistorysmoking"]'
          await page.waitForSelector(smokingHistorySelector, { timeout: 30000 })
          await page.click(smokingHistorySelector)
          console.log('✅ Clicked on patienthistorysmoking mat-select')

          // Wait for listbox to appear and click on mat-option-94
          await new Promise((r) => setTimeout(r, 500))
          const neverOptionSelector =
            'div[role="listbox"] mat-option:nth-child(1)'
          await page.waitForSelector(neverOptionSelector, { timeout: 30000 })
          await page.click(neverOptionSelector)
          console.log('✅ Clicked on never option')

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="alcoholUsage"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector, { timeout: 30000 })
          await page.click(radioButtonSelector)
          console.log('✅ Clicked on alcoholUsage No option')

          // Wait for and click on waistcircumferenceM mat-select
          await new Promise((r) => setTimeout(r, 500))
          const waistCircumferenceSelector = `mat-tab-body.mat-tab-body-active mat-select[name="waistcircumference${
            item.gender === 'F' ? 'F' : 'M'
          }"]`
          await page.waitForSelector(waistCircumferenceSelector, {
            timeout: 30000,
          })
          await page.click(waistCircumferenceSelector)
          console.log('✅ Clicked on waistcircumferenceM mat-select')

          // Generate random number (1 or 2) and select corresponding option
          const randomNumber = Math.floor(Math.random() * 2) + 1 // 1 or 2
          const optionSelectors = [
            'mat-option:nth-child(1)',
            'mat-option:nth-child(2)',
          ]
          const selectedOptionSelector = optionSelectors[randomNumber - 1]
          const optionSelector = `div[role="listbox"] ${selectedOptionSelector}`

          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(optionSelector, { timeout: 30000 })
          await page.click(optionSelector)
          console.log(
            `✅ Clicked on ${selectedOptionSelector} (random number: ${randomNumber})`
          )

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector2 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="physicalActivities"] mat-radio-button:nth-child(1)'
          await page.waitForSelector(radioButtonSelector2, { timeout: 30000 })
          await page.click(radioButtonSelector2)
          console.log('✅ Clicked on physicalActivities for first option')

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector3 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="familyHistory"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector3, { timeout: 30000 })
          await page.click(radioButtonSelector3)
          console.log('✅ Clicked on familyHistory No option')

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const noneOfTheBelowButtonSelector =
            'mat-tab-body.mat-tab-body-active mat-button-toggle-group[name="AllPartBYesNo"]'
          await page.waitForSelector(noneOfTheBelowButtonSelector, {
            timeout: 30000,
          })
          await page.click(noneOfTheBelowButtonSelector)
          console.log('✅ Clicked on none of the below button')

          await new Promise((r) => setTimeout(r, 500))

          const typeFuelforCooking =
            'mat-tab-body.mat-tab-body-active mat-select[name="fuelused"] div div span'

          await page.waitForSelector(typeFuelforCooking, { timeout: 30000 })
          const fuelforCookingSelected = await page.evaluate((selector) => {
            const element = document.querySelector(selector)
            return element ? element.textContent?.trim() : null
          }, typeFuelforCooking)

          if (!fuelforCookingSelected) {
            // Wait for and click on physicalDisablilitySelected mat-select
            await new Promise((r) => setTimeout(r, 500))
            const fuelusedSelector =
              'mat-tab-body.mat-tab-body-active mat-select[name="fuelused"]'
            await page.waitForSelector(fuelusedSelector, {
              timeout: 30000,
            })
            await page.click(fuelusedSelector)
            console.log('✅ Clicked on fuelused mat-select')

            // Wait for listbox to appear and click on "None" option
            await new Promise((r) => setTimeout(r, 500))
            const lpgOptionSelector =
              'div[role="listbox"] mat-option:nth-child(6)'
            await page.waitForSelector(lpgOptionSelector, { timeout: 30000 })
            await page.click(lpgOptionSelector)
            console.log('✅ Clicked on "LPG" option')

            // click on anypart of body to close the listbox
            await new Promise((r) => setTimeout(r, 500))
            await page.keyboard.press('Escape')
            console.log('✅ Pressed Escape key to close the listbox')
          } else {
            console.log('✅ Fuel for cooking selected')
          }

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector4 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="cropresidueburning"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector4, { timeout: 30000 })
          await page.click(radioButtonSelector4)
          console.log('✅ Clicked on cropresidueburning No option')

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector5 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="burninggarbageleaves"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector5, { timeout: 30000 })
          await page.click(radioButtonSelector5)
          console.log('✅ Clicked on burninggarbageleaves No option')

          // Wait for and click on mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector6 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="workinginindustries"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector6, { timeout: 30000 })
          await page.click(radioButtonSelector6)
          console.log('✅ Clicked on workinginindustries No option')

          // Wait for and click on waistcircumferenceM mat-select
          await new Promise((r) => setTimeout(r, 500))
          const pleasureInDoindThingsSelector =
            'mat-tab-body.mat-tab-body-active mat-select[name="littlePleasure"]'
          await page.waitForSelector(pleasureInDoindThingsSelector, {
            timeout: 30000,
          })
          await page.click(pleasureInDoindThingsSelector)
          console.log('✅ Clicked on pleasureInDoindThings mat-select')

          // Wait for listbox to appear and click on mat-option-94
          await new Promise((r) => setTimeout(r, 500))
          const notAtAllOptionSelector =
            'div[role="listbox"] mat-option:nth-child(1)'
          await page.waitForSelector(notAtAllOptionSelector, { timeout: 30000 })
          await page.click(notAtAllOptionSelector)
          console.log('✅ Clicked on not at all option')

          // Wait for and click on waistcircumferenceM mat-select
          await new Promise((r) => setTimeout(r, 500))
          const feelingDownSelector =
            'mat-tab-body.mat-tab-body-active mat-select[name="feelDepressed"]'
          await page.waitForSelector(feelingDownSelector, {
            timeout: 30000,
          })
          await page.click(feelingDownSelector)
          console.log('✅ Clicked on feelingDown mat-select')

          // Wait for listbox to appear and click on mat-option-94
          await new Promise((r) => setTimeout(r, 500))
          const notAtAllOptionSelector2 =
            'div[role="listbox"] mat-option:nth-child(1)'
          await page.waitForSelector(notAtAllOptionSelector2, {
            timeout: 30000,
          })
          await page.click(notAtAllOptionSelector2)
          console.log('✅ Clicked on not at all option2')

          // Wait for and click on save and continue button
          await new Promise((r) => setTimeout(r, 500))
          const saveAndContinueButtonSelector =
            'mat-tab-body.mat-tab-body-active button#saveAndContinueCbackABtn:nth-child(3)'
          await page.waitForSelector(saveAndContinueButtonSelector, {
            timeout: 30000,
          })
          await page.click(saveAndContinueButtonSelector)
          console.log('✅ Clicked on save and continue button')

          await new Promise((r) => setTimeout(r, 500))
          const confirmDialogButtonSelector =
            'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
          await page.waitForSelector(confirmDialogButtonSelector, {
            timeout: 30000,
          })
          await page.click(confirmDialogButtonSelector)
          console.log('✅ Clicked on confirm dialog button')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 1000))

          // Check for "Personal Examination"
          const isPersonalExaminationFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const personalExaminationSpan = spans.find(
              (el) => el.innerText.trim() === 'Personal Examination*'
            )
            return !!personalExaminationSpan
          })

          if (!isPersonalExaminationFound) {
            console.log('⚠️ Skipping: "Personal Examination*" tab not found')
            item.status = 'ERROR'
            item.message = 'Personal Examination* tab not found'
            await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
            await goHome(page)
            continue
          }

          console.log('✅ Found "Personal Examination*". Clicking...')
          await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const personalExaminationSpan = spans.find(
              (el) => el.innerText.trim() === 'Personal Examination*'
            )
            if (personalExaminationSpan) personalExaminationSpan.click()
          })
          console.log('✅ Clicked on "Personal Examination*"')

          await new Promise((r) => setTimeout(r, 500))

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          await new Promise((r) => setTimeout(r, 500))

          const heightSelector =
            'mat-tab-body.mat-tab-body-active input[name="height"]'
          // Pick a random height value between 140 and 165 (inclusive)
          const randomHeight = (
            Math.floor(Math.random() * (165 - 140 + 1)) + 140
          ).toString()
          await inputTargetFilledByLocator({
            page,
            target: heightSelector,
            value: randomHeight,
          })

          await new Promise((r) => setTimeout(r, 500))

          const weightSelector =
            'mat-tab-body.mat-tab-body-active input[name="weight"]'
          // Pick a random weight value between 45 and 75 (inclusive)
          const randomWeight = (
            Math.floor(Math.random() * (75 - 45 + 1)) + 45
          ).toString()
          await inputTargetFilledByLocator({
            page,
            target: weightSelector,
            value: randomWeight,
          })

          await new Promise((r) => setTimeout(r, 500))

          const saveButtonSelector =
            'mat-tab-body.mat-tab-body-active mat-card button#savenexit'
          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 1000))

          // Check for "Personal History"
          const isPersonalHistoryFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const personalHistorySpan = spans.find(
              (el) => el.innerText.trim() === 'Personal History'
            )
            return !!personalHistorySpan
          })

          if (!isPersonalHistoryFound) {
            console.log('⚠️ Skipping: "Personal History" tab not found')
            item.status = 'ERROR'
            item.message = 'Personal History tab not found'
            await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
            await goHome(page)
            continue
          }

          console.log('✅ Found "Personal History". Clicking...')
          await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const personalHistorySpan = spans.find(
              (el) => el.innerText.trim() === 'Personal History'
            )
            if (personalHistorySpan) personalHistorySpan.click()
          })
          console.log('✅ Clicked on "Personal History"')

          await new Promise((r) => setTimeout(r, 500))

          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 1000))

          // Check for "Hypertension"
          const isHypertensionFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
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
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const hypertensionSpan = spans.find(
              (el) => el.innerText.trim() === 'Hypertension'
            )
            if (hypertensionSpan) hypertensionSpan.click()
          })
          console.log('✅ Clicked on "Hypertension 111"')

          await new Promise((r) => setTimeout(r, 500))

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          // Wait for and click on hyperTreatment mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector7 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="hyperTreatment"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector7, { timeout: 30000 })
          await page.click(radioButtonSelector7)
          console.log('✅ Clicked on hyperTreatment No option')

          await new Promise((r) => setTimeout(r, 500))

          const systolicBloodPressureSelector =
            'mat-tab-body.mat-tab-body-active input[name="systolic"]'
          // Pick a random weight value between 100 and 120 (inclusive)
          const randomSystolic = (
            Math.floor(Math.random() * (120 - 100 + 1)) + 100
          ).toString()
          await inputTargetFilledByLocator({
            page,
            target: systolicBloodPressureSelector,
            value: randomSystolic,
          })

          await new Promise((r) => setTimeout(r, 500))

          const diastolicBloodPressureSelector =
            'mat-tab-body.mat-tab-body-active input[name="diastolic"]'
          // Pick a random weight value between 70 and 80 (inclusive)
          const randomDiastolic = (
            Math.floor(Math.random() * (80 - 70 + 1)) + 70
          ).toString()
          await inputTargetFilledByLocator({
            page,
            target: diastolicBloodPressureSelector,
            value: randomDiastolic,
          })

          await new Promise((r) => setTimeout(r, 500))

          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          await new Promise((r) => setTimeout(r, 500))

          const confireDialogButtonSelector =
            'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
          await page.waitForSelector(confireDialogButtonSelector, {
            timeout: 30000,
          })
          await page.click(confireDialogButtonSelector)
          console.log('✅ Clicked on confirm dialog button')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 1000))

          // Check for "Diabetes"
          const isDiabetesFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const diabetesSpan = spans.find(
              (el) => el.innerText.trim() === 'Diabetes'
            )
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
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const diabetesSpan = spans.find(
              (el) => el.innerText.trim() === 'Diabetes'
            )
            if (diabetesSpan) diabetesSpan.click()
          })
          console.log('✅ Clicked on "Diabetes"')

          await new Promise((r) => setTimeout(r, 500))

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          // Wait for and click on diabetesTreatment mat-radio-button
          await new Promise((r) => setTimeout(r, 500))
          const radioButtonSelector8 =
            'mat-tab-body.mat-tab-body-active mat-radio-group[name="diabTreatment"] mat-radio-button:nth-child(2)'
          await page.waitForSelector(radioButtonSelector8, { timeout: 30000 })
          await page.click(radioButtonSelector8)
          console.log('✅ Clicked on diabetesTreatment No option')

          await new Promise((r) => setTimeout(r, 500))

          const randomBloodSugarSelector =
            'mat-tab-body.mat-tab-body-active input[name="randomBloodGlucose"]'
          // Pick a random weight value between 95 and 115 (inclusive)
          const randomBloodSugar = (
            Math.floor(Math.random() * (115 - 95 + 1)) + 95
          ).toString()
          await inputTargetFilledByLocator({
            page,
            target: randomBloodSugarSelector,
            value: randomBloodSugar,
          })
          await new Promise((r) => setTimeout(r, 500))

          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          await new Promise((r) => setTimeout(r, 500))
          const confireDialogButtonSelector2 =
            'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
          await page.waitForSelector(confireDialogButtonSelector2, {
            timeout: 30000,
          })
          await page.click(confireDialogButtonSelector2)
          console.log('✅ Clicked on confirm dialog button2')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 1000))

          // Check for "Oral Cancer"
          const isOralCancerFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const oralCancerSpan = spans.find(
              (el) => el.innerText.trim() === 'Oral Cancer'
            )
            return !!oralCancerSpan
          })

          if (!isOralCancerFound) {
            console.log('⚠️ Skipping: "Oral Cancer" tab not found')
            item.status = 'ERROR'
            item.message = 'Oral Cancer tab not found'
            await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
            await goHome(page)
            continue
          }

          console.log('✅ Found "Oral Cancer". Clicking...')
          await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const oralCancerSpan = spans.find(
              (el) => el.innerText.trim() === 'Oral Cancer'
            )
            if (oralCancerSpan) oralCancerSpan.click()
          })
          console.log('✅ Clicked on "Oral Cancer"')

          await new Promise((r) => setTimeout(r, 500))

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          await new Promise((r) => setTimeout(r, 500))

          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          await new Promise((r) => setTimeout(r, 500))

          const confireDialogButtonSelector3 =
            'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
          await page.waitForSelector(confireDialogButtonSelector3, {
            timeout: 30000,
          })
          await page.click(confireDialogButtonSelector3)
          console.log('✅ Clicked on confirm dialog button3')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // Small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 1000))

          if (item.gender === 'M') {
            console.log('✅ Successfully processed item:', item.id)
            item.status = 'COMPLETED'
            item.message = 'Successfully processed'
            await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
            await goHome(page)
            continue
          }

          if (item.gender === 'F') {
            // Check for "Breast Cancer"
            const isBreastCancerFound = await page.evaluate(() => {
              const spans = Array.from(
                document.querySelectorAll(
                  'div mat-card div figure figcaption span'
                )
              )
              const breastCancerSpan = spans.find(
                (el) => el.innerText.trim() === 'Breast Cancer'
              )
              return !!breastCancerSpan
            })

            if (!isBreastCancerFound) {
              console.log('⚠️ Skipping: "Breast Cancer" tab not found')
              item.status = 'ERROR'
              item.message = 'Breast Cancer tab not found'
              await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
              await goHome(page)
              continue
            }

            console.log('✅ Found "Breast Cancer". Clicking...')
            await page.evaluate(() => {
              const spans = Array.from(
                document.querySelectorAll(
                  'div mat-card div figure figcaption span'
                )
              )
              const breastCancerSpan = spans.find(
                (el) => el.innerText.trim() === 'Breast Cancer'
              )
              if (breastCancerSpan) breastCancerSpan.click()
            })
            console.log('✅ Clicked on "Breast Cancer"')

            await new Promise((r) => setTimeout(r, 500))

            console.log(
              `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
            )

            await page.waitForSelector(toggleBtnSelector)
            await page.click(toggleBtnSelector)
            await new Promise((r) => setTimeout(r, 500))
            await page.waitForSelector(prevMonthSelector1)
            await page.click(prevMonthSelector1)
            await new Promise((r) => setTimeout(r, 500))
            await page.click(prevMonthSelector2)
            await new Promise((r) => setTimeout(r, 500))
            await page.click(prevMonthSelector3)
            await new Promise((r) => setTimeout(r, 500))
            await page.waitForSelector(dateBtnSelector)
            await page.click(dateBtnSelector)

            console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

            await new Promise((r) => setTimeout(r, 500))

            await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
            await page.click(saveButtonSelector)
            console.log('✅ Clicked on save button')

            await new Promise((r) => setTimeout(r, 500))
            const confireDialogButtonSelector4 =
              'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
            await page.waitForSelector(confireDialogButtonSelector4, {
              timeout: 30000,
            })
            await page.click(confireDialogButtonSelector4)
            console.log('✅ Clicked on confirm dialog button4')

            // Wait for the API call to complete and Angular to update the DOM
            try {
              await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
            } catch (e) {
              console.log('Wait for network idle timed out (proceeding check)')
            }

            // Small buffer for DOM rendering
            await new Promise((r) => setTimeout(r, 500))

            // Check for "Cervical Cancer"
            const isCervicalCancerFound = await page.evaluate(() => {
              const spans = Array.from(
                document.querySelectorAll(
                  'div mat-card div figure figcaption span'
                )
              )
              const cervicalCancerSpan = spans.find(
                (el) => el.innerText.trim() === 'Cervical Cancer'
              )
              return !!cervicalCancerSpan
            })

            if (!isCervicalCancerFound) {
              console.log('⚠️ Skipping: "Cervical Cancer" tab not found')
              item.status = 'ERROR'
              item.message = 'Cervical Cancer tab not found'
              await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
              await goHome(page)
              continue
            }

            console.log('✅ Found "Cervical Cancer". Clicking...')
            await page.evaluate(() => {
              const spans = Array.from(
                document.querySelectorAll(
                  'div mat-card div figure figcaption span'
                )
              )
              const cervicalCancerSpan = spans.find(
                (el) => el.innerText.trim() === 'Cervical Cancer'
              )
              if (cervicalCancerSpan) cervicalCancerSpan.click()
            })
            console.log('✅ Clicked on "Cervical Cancer"')

            await new Promise((r) => setTimeout(r, 500))

            console.log(
              `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
            )

            await page.waitForSelector(toggleBtnSelector)
            await page.click(toggleBtnSelector)
            await new Promise((r) => setTimeout(r, 500))
            await page.waitForSelector(prevMonthSelector1)
            await page.click(prevMonthSelector1)
            await new Promise((r) => setTimeout(r, 500))
            await page.click(prevMonthSelector2)
            await new Promise((r) => setTimeout(r, 500))
            await page.click(prevMonthSelector3)
            await new Promise((r) => setTimeout(r, 500)) // wait for animation
            await page.waitForSelector(dateBtnSelector)
            await page.click(dateBtnSelector)

            console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

            await new Promise((r) => setTimeout(r, 500))

            await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
            await page.click(saveButtonSelector)
            console.log('✅ Clicked on save button')

            await new Promise((r) => setTimeout(r, 500))
            const confireDialogButtonSelector5 =
              'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
            await page.waitForSelector(confireDialogButtonSelector5, {
              timeout: 30000,
            })
            await page.click(confireDialogButtonSelector5)
            console.log('✅ Clicked on confirm dialog button5')

            try {
              await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
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
            continue
          }
        } catch (e) {
          console.log(
            '⚠️ Error handling CBAC physical disability select:',
            e.message
          )
        }
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Check for Patient already referred to higher facility model randomly
      try {
        const randomModelSelector2 =
          'mat-dialog-container app-matdialog mat-dialog-actions button'
        const x = await page.waitForSelector(randomModelSelector2, {
          timeout: 2000,
        })
        await page.click(randomModelSelector2)
        item.status = 'ERROR'
        item.message =
          'It is recommended to capture Personal History for the individual.'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      } catch (e) {
        console.log(e.message)
        console.log(
          '⚠️ It is recommended to capture Personal History for the individual.',
          e
        )
      }

      // Wait for the API call to complete and Angular to update the DOM
      try {
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
      } catch (e) {
        console.log('Wait for network idle timed out (proceeding check)')
      }

      // Small buffer for DOM rendering
      await new Promise((r) => setTimeout(r, 1000))

      // Check for "Personal Examination"
      const isPersonalExaminationFound = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('div mat-card div figure figcaption span')
        )
        const personalExaminationSpan = spans.find(
          (el) => el.innerText.trim() === 'Personal Examination*'
        )
        return !!personalExaminationSpan
      })

      if (!isPersonalExaminationFound) {
        console.log('⚠️ Skipping: "Personal Examination*" tab not found')
        item.status = 'ERROR'
        item.message = 'Personal Examination* tab not found'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      }

      // Check the parent figure's h5 status text for "Not Started"
      const isPersonalExaminationNotStarted = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll('div mat-card div figure figcaption span')
        )

        const personalExaminationSpan = spans.find(
          (el) => el.innerText.trim() === 'Personal Examination*'
        )
        if (!personalExaminationSpan) return false

        const figure = personalExaminationSpan.closest('figure')
        if (!figure) return false

        const h5 = figure.querySelector('h5')
        const h5Text = (h5?.innerText || '').trim()
        return h5Text === 'Not Started' || h5Text.includes('Not Started')
      })

      if (isPersonalExaminationNotStarted) {
        const days = [22, 23, 24, 25, 26]
        const randomDay = days[Math.floor(Math.random() * days.length)]

        console.log('✅ Found "Personal Examination*". Clicking...')
        await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div mat-card div figure figcaption span')
          )
          const personalExaminationSpan = spans.find(
            (el) => el.innerText.trim() === 'Personal Examination*'
          )
          if (personalExaminationSpan) personalExaminationSpan.click()
        })
        console.log('✅ Clicked on "Personal Examination*"')

        await new Promise((r) => setTimeout(r, 500))

        console.log(
          `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
        )

        // 1. Click the toggle button
        const toggleBtnSelector =
          'mat-tab-body.mat-tab-body-active mat-form-field div div div mat-datepicker-toggle button'
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

        const prevMonthSelector3 =
          'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
        await page.click(prevMonthSelector3)
        await new Promise((r) => setTimeout(r, 500)) // wait for animation

        // 3. Click the specific date
        // Randomly select a date between 13, 14, 15, 16, 17
        const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="December ${randomDay}, 2025"]`
        await page.waitForSelector(dateBtnSelector)
        await page.click(dateBtnSelector)

        console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

        // Wait for and click on physicalDisablilitySelected mat-select
        await new Promise((r) => setTimeout(r, 500))

        const heightSelector =
          'mat-tab-body.mat-tab-body-active input[name="height"]'
        // Pick a random height value between 140 and 165 (inclusive)
        const randomHeight = (
          Math.floor(Math.random() * (165 - 140 + 1)) + 140
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: heightSelector,
          value: randomHeight,
        })

        await new Promise((r) => setTimeout(r, 500))

        const weightSelector =
          'mat-tab-body.mat-tab-body-active input[name="weight"]'
        // Pick a random weight value between 45 and 75 (inclusive)
        const randomWeight = (
          Math.floor(Math.random() * (75 - 45 + 1)) + 45
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: weightSelector,
          value: randomWeight,
        })

        await new Promise((r) => setTimeout(r, 500))

        const saveButtonSelector =
          'mat-tab-body.mat-tab-body-active mat-card button#savenexit'
        await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
        await page.click(saveButtonSelector)
        console.log('✅ Clicked on save button')

        // Wait for the API call to complete and Angular to update the DOM
        try {
          await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
        } catch (e) {
          console.log('Wait for network idle timed out (proceeding check)')
        }

        // small buffer for DOM rendering
        await new Promise((r) => setTimeout(r, 1000))

        // Check for "Personal History"
        const isPersonalHistoryFound = await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div mat-card div figure figcaption span')
          )
          const personalHistorySpan = spans.find(
            (el) => el.innerText.trim() === 'Personal History'
          )
          return !!personalHistorySpan
        })

        if (!isPersonalHistoryFound) {
          console.log('⚠️ Skipping: "Personal History" tab not found')
          item.status = 'ERROR'
          item.message = 'Personal History tab not found'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        }

        console.log('✅ Found "Personal History". Clicking...')
        await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div mat-card div figure figcaption span')
          )
          const personalHistorySpan = spans.find(
            (el) => el.innerText.trim() === 'Personal History'
          )
          if (personalHistorySpan) personalHistorySpan.click()
        })
        console.log('✅ Clicked on "Personal History"')

        await new Promise((r) => setTimeout(r, 500))

        await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
        await page.click(saveButtonSelector)
        console.log('✅ Clicked on save button')

        // Wait for the API call to complete and Angular to update the DOM
        try {
          await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
        } catch (e) {
          console.log('Wait for network idle timed out (proceeding check)')
        }

        // small buffer for DOM rendering
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

        await new Promise((r) => setTimeout(r, 500))

        console.log(
          `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
        )

        await page.waitForSelector(toggleBtnSelector)
        await page.click(toggleBtnSelector)
        await new Promise((r) => setTimeout(r, 500))
        await page.waitForSelector(prevMonthSelector1)
        await page.click(prevMonthSelector1)
        await new Promise((r) => setTimeout(r, 500))
        await page.click(prevMonthSelector2)
        await new Promise((r) => setTimeout(r, 500))
        await page.click(prevMonthSelector3)
        await new Promise((r) => setTimeout(r, 500))
        await page.waitForSelector(dateBtnSelector)
        await page.click(dateBtnSelector)

        console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

        // Wait for and click on hyperTreatment mat-radio-button
        await new Promise((r) => setTimeout(r, 500))
        const radioButtonSelector7 =
          'mat-tab-body.mat-tab-body-active mat-radio-group[name="hyperTreatment"] mat-radio-button:nth-child(2)'
        await page.waitForSelector(radioButtonSelector7, { timeout: 30000 })
        await page.click(radioButtonSelector7)
        console.log('✅ Clicked on hyperTreatment No option')

        await new Promise((r) => setTimeout(r, 500))

        const systolicBloodPressureSelector =
          'mat-tab-body.mat-tab-body-active input[name="systolic"]'
        // Pick a random weight value between 100 and 120 (inclusive)
        const randomSystolic = (
          Math.floor(Math.random() * (120 - 100 + 1)) + 100
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: systolicBloodPressureSelector,
          value: randomSystolic,
        })

        await new Promise((r) => setTimeout(r, 500))

        const diastolicBloodPressureSelector =
          'mat-tab-body.mat-tab-body-active input[name="diastolic"]'
        // Pick a random weight value between 70 and 80 (inclusive)
        const randomDiastolic = (
          Math.floor(Math.random() * (80 - 70 + 1)) + 70
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: diastolicBloodPressureSelector,
          value: randomDiastolic,
        })

        await new Promise((r) => setTimeout(r, 500))

        await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
        await page.click(saveButtonSelector)
        console.log('✅ Clicked on save button')

        await new Promise((r) => setTimeout(r, 500))

        const confireDialogButtonSelector =
          'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
        await page.waitForSelector(confireDialogButtonSelector, {
          timeout: 30000,
        })
        await page.click(confireDialogButtonSelector)
        console.log('✅ Clicked on confirm dialog button')

        // Wait for the API call to complete and Angular to update the DOM
        try {
          await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
        } catch (e) {
          console.log('Wait for network idle timed out (proceeding check)')
        }

        // small buffer for DOM rendering
        await new Promise((r) => setTimeout(r, 1000))

        // Check for "Diabetes"
        const isDiabetesFound = await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div mat-card div figure figcaption span')
          )
          const diabetesSpan = spans.find(
            (el) => el.innerText.trim() === 'Diabetes'
          )
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
          const diabetesSpan = spans.find(
            (el) => el.innerText.trim() === 'Diabetes'
          )
          if (diabetesSpan) diabetesSpan.click()
        })
        console.log('✅ Clicked on "Diabetes"')

        await new Promise((r) => setTimeout(r, 500))

        console.log(
          `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
        )

        await page.waitForSelector(toggleBtnSelector)
        await page.click(toggleBtnSelector)
        await new Promise((r) => setTimeout(r, 500))
        await page.waitForSelector(prevMonthSelector1)
        await page.click(prevMonthSelector1)
        await new Promise((r) => setTimeout(r, 500))
        await page.click(prevMonthSelector2)
        await new Promise((r) => setTimeout(r, 500))
        await page.click(prevMonthSelector3)
        await new Promise((r) => setTimeout(r, 500)) // wait for animation
        await page.waitForSelector(dateBtnSelector)
        await page.click(dateBtnSelector)

        console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

        // Wait for and click on diabetesTreatment mat-radio-button
        await new Promise((r) => setTimeout(r, 500))
        const radioButtonSelector8 =
          'mat-tab-body.mat-tab-body-active mat-radio-group[name="diabTreatment"] mat-radio-button:nth-child(2)'
        await page.waitForSelector(radioButtonSelector8, { timeout: 30000 })
        await page.click(radioButtonSelector8)
        console.log('✅ Clicked on diabetesTreatment No option')

        await new Promise((r) => setTimeout(r, 500))

        const randomBloodSugarSelector =
          'mat-tab-body.mat-tab-body-active input[name="randomBloodGlucose"]'
        // Pick a random weight value between 95 and 115 (inclusive)
        const randomBloodSugar = (
          Math.floor(Math.random() * (115 - 95 + 1)) + 95
        ).toString()
        await inputTargetFilledByLocator({
          page,
          target: randomBloodSugarSelector,
          value: randomBloodSugar,
        })
        await new Promise((r) => setTimeout(r, 500))

        await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
        await page.click(saveButtonSelector)
        console.log('✅ Clicked on save button')

        await new Promise((r) => setTimeout(r, 500))
        const confireDialogButtonSelector2 =
          'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
        await page.waitForSelector(confireDialogButtonSelector2, {
          timeout: 30000,
        })
        await page.click(confireDialogButtonSelector2)
        console.log('✅ Clicked on confirm dialog button2')

        // Wait for the API call to complete and Angular to update the DOM
        try {
          await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
        } catch (e) {
          console.log('Wait for network idle timed out (proceeding check)')
        }

        // small buffer for DOM rendering
        await new Promise((r) => setTimeout(r, 1000))

        // Check for "Oral Cancer"
        const isOralCancerFound = await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div mat-card div figure figcaption span')
          )
          const oralCancerSpan = spans.find(
            (el) => el.innerText.trim() === 'Oral Cancer'
          )
          return !!oralCancerSpan
        })

        if (!isOralCancerFound) {
          console.log('⚠️ Skipping: "Oral Cancer" tab not found')
          item.status = 'ERROR'
          item.message = 'Oral Cancer tab not found'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        }

        console.log('✅ Found "Oral Cancer". Clicking...')
        await page.evaluate(() => {
          const spans = Array.from(
            document.querySelectorAll('div mat-card div figure figcaption span')
          )
          const oralCancerSpan = spans.find(
            (el) => el.innerText.trim() === 'Oral Cancer'
          )
          if (oralCancerSpan) oralCancerSpan.click()
        })
        console.log('✅ Clicked on "Oral Cancer"')

        await new Promise((r) => setTimeout(r, 500))

        console.log(
          `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
        )

        await page.waitForSelector(toggleBtnSelector)
        await page.click(toggleBtnSelector)
        await new Promise((r) => setTimeout(r, 500))
        await page.waitForSelector(prevMonthSelector1)
        await page.click(prevMonthSelector1)
        await new Promise((r) => setTimeout(r, 500))
        await page.click(prevMonthSelector2)
        await new Promise((r) => setTimeout(r, 500))
        await page.click(prevMonthSelector3)
        await new Promise((r) => setTimeout(r, 500)) // wait for animation
        await page.waitForSelector(dateBtnSelector)
        await page.click(dateBtnSelector)

        console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

        await new Promise((r) => setTimeout(r, 500))

        await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
        await page.click(saveButtonSelector)
        console.log('✅ Clicked on save button')

        await new Promise((r) => setTimeout(r, 500))

        const confireDialogButtonSelector3 =
          'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
        await page.waitForSelector(confireDialogButtonSelector3, {
          timeout: 30000,
        })
        await page.click(confireDialogButtonSelector3)
        console.log('✅ Clicked on confirm dialog button3')

        // Wait for the API call to complete and Angular to update the DOM
        try {
          await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
        } catch (e) {
          console.log('Wait for network idle timed out (proceeding check)')
        }

        // Small buffer for DOM rendering
        await new Promise((r) => setTimeout(r, 1000))

        if (item.gender === 'M') {
          console.log('✅ Successfully processed item:', item.id)
          item.status = 'COMPLETED'
          item.message = 'Successfully processed'
          await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
          await goHome(page)
          continue
        }

        if (item.gender === 'F') {
          // Check for "Breast Cancer"
          const isBreastCancerFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const breastCancerSpan = spans.find(
              (el) => el.innerText.trim() === 'Breast Cancer'
            )
            return !!breastCancerSpan
          })

          if (!isBreastCancerFound) {
            console.log('⚠️ Skipping: "Breast Cancer" tab not found')
            item.status = 'ERROR'
            item.message = 'Breast Cancer tab not found'
            await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
            await goHome(page)
            continue
          }

          console.log('✅ Found "Breast Cancer". Clicking...')
          await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const breastCancerSpan = spans.find(
              (el) => el.innerText.trim() === 'Breast Cancer'
            )
            if (breastCancerSpan) breastCancerSpan.click()
          })
          console.log('✅ Clicked on "Breast Cancer"')

          await new Promise((r) => setTimeout(r, 500))

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          await new Promise((r) => setTimeout(r, 500))

          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          await new Promise((r) => setTimeout(r, 500))
          const confireDialogButtonSelector4 =
            'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
          await page.waitForSelector(confireDialogButtonSelector4, {
            timeout: 30000,
          })
          await page.click(confireDialogButtonSelector4)
          console.log('✅ Clicked on confirm dialog button4')

          // Wait for the API call to complete and Angular to update the DOM
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
          } catch (e) {
            console.log('Wait for network idle timed out (proceeding check)')
          }

          // Small buffer for DOM rendering
          await new Promise((r) => setTimeout(r, 500))

          // Check for "Cervical Cancer"
          const isCervicalCancerFound = await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const cervicalCancerSpan = spans.find(
              (el) => el.innerText.trim() === 'Cervical Cancer'
            )
            return !!cervicalCancerSpan
          })

          if (!isCervicalCancerFound) {
            console.log('⚠️ Skipping: "Cervical Cancer" tab not found')
            item.status = 'ERROR'
            item.message = 'Cervical Cancer tab not found'
            await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
            await goHome(page)
            continue
          }

          console.log('✅ Found "Cervical Cancer". Clicking...')
          await page.evaluate(() => {
            const spans = Array.from(
              document.querySelectorAll(
                'div mat-card div figure figcaption span'
              )
            )
            const cervicalCancerSpan = spans.find(
              (el) => el.innerText.trim() === 'Cervical Cancer'
            )
            if (cervicalCancerSpan) cervicalCancerSpan.click()
          })
          console.log('✅ Clicked on "Cervical Cancer"')

          await new Promise((r) => setTimeout(r, 500))

          console.log(
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
          )

          await page.waitForSelector(toggleBtnSelector)
          await page.click(toggleBtnSelector)
          await new Promise((r) => setTimeout(r, 500))
          await page.waitForSelector(prevMonthSelector1)
          await page.click(prevMonthSelector1)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector2)
          await new Promise((r) => setTimeout(r, 500))
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          await page.waitForSelector(dateBtnSelector)
          await page.click(dateBtnSelector)

          console.log(`✅ Date selected via UI: ${randomDay}-12-2025`)

          await new Promise((r) => setTimeout(r, 500))

          await page.waitForSelector(saveButtonSelector, { timeout: 30000 })
          await page.click(saveButtonSelector)
          console.log('✅ Clicked on save button')

          await new Promise((r) => setTimeout(r, 500))
          const confireDialogButtonSelector5 =
            'mat-dialog-container app-matdialog div mat-dialog-actions div button:nth-child(1)'
          await page.waitForSelector(confireDialogButtonSelector5, {
            timeout: 30000,
          })
          await page.click(confireDialogButtonSelector5)
          console.log('✅ Clicked on confirm dialog button5')

          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 })
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
          continue
        }
      }

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

      const days = [22, 23, 24, 25, 26]
      const randomDay = days[Math.floor(Math.random() * days.length)]

      // Check for Patient already referred to higher facility model randomly
      try {
        const randomModelSelector2 =
          'mat-dialog-container app-matdialog mat-dialog-actions button'
        const x = await page.waitForSelector(randomModelSelector2, {
          timeout: 2000,
        })
        await page.click(randomModelSelector2)
        item.status = 'ERROR'
        item.message = 'Patient already referred to higher facility'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      } catch (e) {
        console.log(
          '⚠️ Patient already referred to higher facility model not found',
          e
        )
      }

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
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
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

          const prevMonthSelector3 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          console.log('============>', prevMonthSelector3)
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation

          // 3. Click the specific date
          // Randomly select a date between 13, 14, 15, 16, 17
          const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="December ${randomDay}, 2025"]`
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

      // Check for Patient already referred to higher facility model randomly
      try {
        const randomModelSelector2 =
          'mat-dialog-container app-matdialog mat-dialog-actions button'
        const x = await page.waitForSelector(randomModelSelector2, {
          timeout: 2000,
        })
        console.log('============>', x)
        await page.click(randomModelSelector2)
        item.status = 'ERROR'
        item.message = 'Patient already referred to higher facility'
        await fs.writeFile('./data.json', JSON.stringify(data, null, 2))
        await goHome(page)
        continue
      } catch (e) {
        console.log(
          '⚠️ Patient already referred to higher facility model not found',
          e
        )
      }

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
            `✅ Date picker is active. Selecting ${randomDay}-12-2025 via UI...`
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
          const prevMonthSelector3 =
            'mat-calendar mat-calendar-header button[aria-label="Previous month"]'
          console.log('>>>>>>>>>>>>>>>', prevMonthSelector3)
          await page.click(prevMonthSelector3)
          await new Promise((r) => setTimeout(r, 500)) // wait for animation
          // wait for animation

          // 3. Click the specific date
          // Randomly select a date between 13, 14, 15, 16, 17
          const dateBtnSelector = `mat-calendar mat-month-view table tbody tr td button[aria-label="December ${randomDay}, 2025"]`
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
