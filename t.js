const { TextractClient, AnalyzeDocumentCommand } = require("@aws-sdk/client-textract");
const fs = require('fs');
const config = require('./config');

// Configure the AWS SDK
const awsConfig = {
    credentials: {
      accessKeyId: "AKIA3RJI62MG2UEHKD5M",
      secretAccessKey: "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",
    },
    region: "ap-south-1",
  };

const textract = new TextractClient(awsConfig);

// Function to extract passport numbers from a given data buffer
async function extractPassportNumbersFromBuffer(buffer) {
  try {
    // Utility function to extract passport numbers from the given text data
    function extractPassportNumbers(dataList) {
      const passportNumberPattern = /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z]*\d)[A-Za-z0-9]{6,20}\b/g;
      const passportNumbers = [];

      for (const element of dataList) {
        const matches = element.match(passportNumberPattern);

        if (matches) {
          const filteredMatches = matches.filter(match => match.length >= 6 && match.length <= 20);
          passportNumbers.push(...filteredMatches);
        }
      }

      return passportNumbers;
    }

    // Utility function to extract specific lines of text from the Textract response
    function displayText(response, extractBy) {
      const lineText = [];
      for (const block of response.Blocks) {
        if (block.BlockType === extractBy) {
          lineText.push(block.Text);
        }
      }
      return lineText;
    }

    // Define the parameters for the AnalyzeDocumentCommand
    const params = {
      Document: {
        Bytes: buffer
      },
      FeatureTypes: ["FORMS"]
    };

    // Call the AnalyzeDocumentCommand to extract the text
    const data = await textract.send(new AnalyzeDocumentCommand(params));

    // Extract specific lines of text
    const rawText = displayText(data, 'LINE');
    const passportNumbers = extractPassportNumbers(rawText);

    return passportNumbers;
  } catch (err) {
    console.error(err);
    throw err;
  }
}

// Example usage with a data buffer
module.exports = {
    extractPassportNumbersFromBuffer
}
