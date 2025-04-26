// Rtps Web API Automation in Node.js with Express and Selenium

const express = require("express");
const bodyParser = require("body-parser");
const { Builder, By, until, Key } = require("selenium-webdriver");
require("chromedriver");
const { Select } = require('selenium-webdriver/lib/select');
const fs = require('fs');
const path = require('path');
const app = express();
const Tesseract = require('tesseract.js');

app.use(bodyParser.json());

app.post("/api/rtps/apply/residential", async (req, res) => {
  const MAX_RETRIES = 5;
  let attempts = 0;
  let success = false;
  let lastError = null;
  let driver;
  const data = req.body;

  // Retry loop
  while (attempts < MAX_RETRIES && !success) {
    attempts++;
    console.log(`Attempt ${attempts} of ${MAX_RETRIES}`);
    
    try {
      if (driver) {
        await driver.quit(); // Clean up previous driver instance if it exists
      }
      
      const chrome = require("selenium-webdriver/chrome");
      let options = new chrome.Options();
      options.addArguments("--window-size=1366,768");
      options.addArguments('--headless'); // Run in headless mode
      options.addArguments('--disable-gpu'); // Optional: better compatibility

      driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

      await driver.get("https://serviceonline.bihar.gov.in/");
      await driver.get("https://qrgo.page.link/8YEcD");
      await driver.sleep(2000);
      
      let captchaAnswerText = await processCaptcha(driver);
      
      if (data.gender === "male") await driver.findElement(By.id("17290_1")).click();
      else if (data.gender === "female") await driver.findElement(By.id("17290_2")).click();

      const fillInput = async (id, value) => {
        await driver.executeScript(`document.getElementById('${id}').value = arguments[0]`, value);
      };

      await fillInput("78250", data.engName);
      await fillInput("17287", data.hinName);
      await fillInput("78251", data.engFather);
      await fillInput("17288", data.hinFather);
      await fillInput("41565", data.engMonther);
      await fillInput("41567", data.hinMother);
      await fillInput("64876", data.engHusband);
      await fillInput("64877", data.hinHusband);
      await fillInput("56887", data.ward);
      await fillInput("17299", data.village);
      await fillInput("17300", data.post);
      await fillInput("90772", data.pinCode);
      await fillInput("17293", data.mob);
      await fillInput("17294", data.email);
      await driver.findElement(By.id("17391")).sendKeys("Bihar");

      await selectOptionIgnoringSpaces(driver,"17297", data.dist);
      await selectOptionIgnoringSpaces(driver,"17296", data.subDivision);
      await selectOptionIgnoringSpaces(driver,"17298", data.block);

      if (data.urbanLocalBodyType === "GramPanchayat") {
        await driver.findElement(By.id("75290_1")).click();
        await selectOptionIgnoringSpaces(driver,"56886", data.panchayat);
      } else if (data.urbanLocalBodyType === "NagarNigam") {
        await driver.findElement(By.id("75290_2")).click();
        await selectOptionIgnoringSpaces(driver,"75291", data.panchayat);
      } else if (data.urbanLocalBodyType === "NagarParisad") {
        await driver.findElement(By.id("75290_3")).click();
        await selectOptionIgnoringSpaces(driver,"75292", data.panchayat);
      } else if (data.urbanLocalBodyType === "NagarPanchayat") {
        await driver.findElement(By.id("75290_4")).click();
        await selectOptionIgnoringSpaces(driver,"75293", data.panchayat);
      }

      await selectOptionIgnoringSpaces(driver,"65015", data.policeStation);
      const docDirectory = path.resolve('./photoAndDoc');
      if (!fs.existsSync(docDirectory)) {
        fs.mkdirSync(docDirectory, { recursive: true });
      }
      data.photoPath = path.join(docDirectory, path.basename(data.photoPath));
      await driver.findElement(By.id("90837")).sendKeys(data.photoPath);
      await driver.findElement(By.id("41566_1")).click();
      await driver.findElement(By.id("captchaAnswer")).sendKeys(captchaAnswerText);
      await driver.findElement(By.id("submit_btn")).click();
      await driver.sleep(1000);
      await driver.switchTo().alert().accept();
      await driver.sleep(2000);
      await driver.findElement(By.id("submit_btn")).click();
      await driver.sleep(1000);
      await selectOptionIgnoringSpaces(driver,"4867_enclDoc_cb", "आधार कार्ड");
      data.docPath = path.join(docDirectory, path.basename(data.docPath));
      await driver.findElement(By.id("4867_attach")).sendKeys(data.docPath);
      await driver.findElement(By.id("submit_btn")).click();
      await driver.sleep(1000);
      await driver.findElement(By.id("submit_btn")).click();

      // Verify success by checking for application number
      const appNoElem = await driver.findElement(By.xpath("//*[@id='printDiv']/div[2]/table[1]/tbody/tr/td/table/tbody/tr[8]/td[2]/span"));
      const applicationNumber = await appNoElem.getText();
      
      // Get the full HTML of the page
      const pageHtml = await driver.getPageSource();
      
      // Save the HTML locally
      const applicationDir = path.resolve('./applications');
      if (!fs.existsSync(applicationDir)) {
        fs.mkdirSync(applicationDir, { recursive: true });
      }
      
      const safeFileName = `${applicationNumber.replaceAll("/", "_").replace(/:/g,"").trim()}`;
      const filePath = path.join(applicationDir, `${safeFileName}.html`);
      fs.writeFileSync(filePath, pageHtml, 'utf8');
      
      // Send the successful response
      res.json({ 
        success: true, 
        applicationNumber,
        pageHtml: pageHtml,
        savedFilePath: filePath,
        attempts: attempts
      });
      
      success = true; // Exit the retry loop
      await driver.quit();
      
    } catch (error) {
      console.error(`Attempt ${attempts} failed with error:`, error.message);
      lastError = error;
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // If all retries failed, return error response
  if (!success) {
    if (driver) {
      try {
        await driver.quit();
      } catch (cleanupError) {
        console.error("Error cleaning up driver:", cleanupError);
      }
    }
    
    res.status(500).json({ 
      success: false, 
      message: lastError ? lastError.message : "Application submission failed after maximum retries",
      attempts: attempts
    });
  }
});

async function selectOptionIgnoringSpaces(driver, dropdownId, targetText) {
  try {
      let element = await driver.findElement(By.id(dropdownId));
      let select = new Select(element);
      let options = await select.getOptions();

      let cleanTarget = targetText.replace(/\s+/g, '').trim();
      let found = false;

      for (let option of options) {
          let text = await option.getText();
          let cleanOption = text.replace(/\s+/g, '').trim();

          if (cleanOption === cleanTarget) {
              await option.click();
              found = true;
              break;
          }
      }

      if (!found) {
          console.warn(`Option '${targetText}' not found in dropdown ${dropdownId}!`);
      }
  } catch (error) {
      console.error("Error selecting dropdown option:", error);
      throw error; // Rethrow to trigger retry
  }
}

async function saveCaptchaImage(driver) {
  try {
      const captchaElement = await driver.findElement(By.xpath("//*[@id='captchaImage']"));
      
      // Create directory if it doesn't exist
      const captchaDir = path.resolve('./captcha');
      if (!fs.existsSync(captchaDir)) {
          fs.mkdirSync(captchaDir, { recursive: true });
      }
      
      // Generate filename with current datetime
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(captchaDir, `captcha-${timestamp}.png`);
      
      // Get screenshot of the captcha element
      const image = await captchaElement.takeScreenshot();
      
      // Save the image to file (base64 data needs to be decoded)
      fs.writeFileSync(filePath, image, 'base64');

      console.log(`Captcha saved at: ${filePath}`);
      return filePath;
  } catch (error) {
      console.error('Error capturing CAPTCHA:', error);
      throw error;
  }
}

async function extractCaptchaText(imagePath) {
  try {
    console.log(`Extracting text from captcha at: ${imagePath}`);
    
    // Configure Tesseract with options for better captcha recognition
    const result = await Tesseract.recognize(
      imagePath,
      'eng',
      { 
        logger: m => console.log(m),
        tessedit_char_whitelist: '0123456789' 
      }
    );
    
    // Clean the recognized text by removing whitespace
    const captchaText = result.data.text.trim();
    
    console.log(`Extracted captcha text: ${captchaText}`);
    return captchaText;
  } catch (error) {
    console.error('Error extracting text from captcha:', error);
    throw error;
  }
}

async function processCaptcha(driver) {
  // Save the captcha image
  const imagePath = await saveCaptchaImage(driver);
  
  // Extract text from the captcha image
  const captchaText = await extractCaptchaText(imagePath);
  
  return captchaText;
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`RTPS Web API running on http://localhost:${PORT}`);
});