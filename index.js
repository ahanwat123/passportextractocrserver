const express = require("express");
const fs = require("fs");
const csv = require("csvtojson");
const axios = require("axios");
const {
  TextractClient,
  AnalyzeDocumentCommand,
} = require("@aws-sdk/client-textract");
const multer = require("multer");
const { extractPassportNumbersFromBuffer } = require("./t");
const { extractPassportInfo } = require("./hjk");
const keyforchatgpt = process.env.chatGptKey;
const accessKeyId = process.env.accessKeyId;
const secretAccessKey = process.env.secretAccessKey;
const app = express();
const PORT = process.env.PORT || 4000;
function adjustDates(residentInfo) {
  const issueDate = new Date(residentInfo["Issue Date"]);
  const expiryDate = new Date(residentInfo["Expiry Date"]);

  if (issueDate >= expiryDate) {
    const newIssueDate = new Date(expiryDate);
    const newExpiryDate = new Date(issueDate);
    
    return {
      "Resident ID": residentInfo["Resident ID"],
      "Issue Date": newIssueDate.toISOString().split('T')[0],
      "Expiry Date": newExpiryDate.toISOString().split('T')[0]
    };
  } else {
    return residentInfo;
  }
}

// Replace these values with your actual AWS credentials
// const awsConfig = {
//   credentials: {
//     accessKeyId: "AKIA3RJI62MG2UEHKD5M",
//     secretAccessKey: "HkCTEzb4oschdi+AbDeOCmeIOXcDp8t6VzAKdX6n",
//   },
//   region: "ap-south-1",
// };
const awsConfig = {
  credentials: {
    accessKeyId: `${accessKeyId}`,
    secretAccessKey: `${secretAccessKey}`,
  },
  region: "ap-south-1",
};

const textract = new TextractClient(awsConfig);

// Middleware to parse JSON and handle potential errors
app.use(express.json());

// Middleware for CORS (Cross-Origin Resource Sharing)
app.use((req, res, next) => {
  //res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  res.setHeader("Access-Control-Allow-Origin", "https://passport-infocheck.vercel.app"); // Replace with the allowed domain
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

// Middleware for rate limiting
const rateLimit = require("express-rate-limit");
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Middleware for API key authentication (optional)
const API_KEY = "avinash"; // Replace with your API key
const requireApiKey = (req, res, next) => {
  const providedApiKey = req.header("Authorization");
  if (providedApiKey === API_KEY) {
    return next();
  } else {
    return res.status(401).json({ error: "Invalid API key." });
  }
};









const getText = (result, blocksMap) => {
  let text = "";

  if (result.Relationships) {
    result.Relationships.forEach((relationship) => {
      if (relationship.Type === "CHILD") {
        relationship.Ids.forEach((childId) => {
          const word = blocksMap[childId];
          if (word.BlockType === "WORD") {
            text += `${word.Text} `;
          }
          if (word.BlockType === "SELECTION_ELEMENT") {
            if (word.SelectionStatus === "SELECTED") {
              text += `X `;
            }
          }
        });
      }
    });
  }
  //console.log(text)
  return text.trim();
};

const findValueBlock = (keyBlock, valueMap) => {
  let valueBlock;
  keyBlock.Relationships.forEach((relationship) => {
    if (relationship.Type === "VALUE") {
      relationship.Ids.some((valueId) => {
        if (valueMap[valueId]) {
          valueBlock = valueMap[valueId];
          return true;
        }
      });
    }
  });
  //console.log(valueBlock)
  return valueBlock;
};

const getKeyValueRelationship = (keyMap, valueMap, blockMap) => {
  const keyValues = {};

  const keyMapValues = Object.values(keyMap);

  keyMapValues.forEach((keyMapValue) => {
    const valueBlock = findValueBlock(keyMapValue, valueMap);
    const key = getText(keyMapValue, blockMap);
    const value = getText(valueBlock, blockMap);
    keyValues[key] = value;
  });
  //console.log(keyValues);
  return keyValues;
};
const getKeyValueMap = (blocks) => {
  const keyMap = {};
  const valueMap = {};
  const blockMap = {};

  let blockId;
  blocks.forEach((block) => {
    blockId = block.Id;
    blockMap[blockId] = block;

    if (block.BlockType === "KEY_VALUE_SET") {
      if (block.EntityTypes.includes("KEY")) {
        keyMap[blockId] = block;
      } else {
        valueMap[blockId] = block;
      }
    }
  });

  return { keyMap, valueMap, blockMap };
};
// Other utility functions (getText, getKeyValueRelationship, getKeyValueMap, findValueBlock, etc.) remain unchanged.

const extractKeyValuePairsFromDocument = async (buffer) => {
  try {
    const params = {
      Document: {
        Bytes: buffer,
      },
      FeatureTypes: ["FORMS"],
    };

    const command = new AnalyzeDocumentCommand(params);
    const data = await textract.send(command);

    if (data.Blocks) {
      const { keyMap, valueMap, blockMap } = getKeyValueMap(data.Blocks);
      const keyValues = getKeyValueRelationship(keyMap, valueMap, blockMap);

      // Convert key-value pairs to CSV format

      return keyValues;
    }

    // In case no blocks are found, return undefined
    return undefined;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};
async function extractTextFromDocument(buffer) {
  try {
    const params = {
      Document: {
        Bytes: buffer,
      },
      FeatureTypes: ["FORMS"], // You can adjust this based on your needs
    };

    const command = new AnalyzeDocumentCommand(params);
    const data = await textract.send(command);

    const lineText = [];
    for (const block of data.Blocks) {
      if (block.BlockType === "LINE") {
        lineText.push(block.Text);
      }
    }

    return lineText;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}

async function callChatGPTAPI(data1, data2) {
   const apiUrl1 = 'https://testapi.io/api/avina/prompt';
   let prompt = "djdjd"
  try {
    const response = await axios.get(apiUrl1);
    // Handle the API response data here
    console.log('API Response:', response.data.prompt);
    const newprompt = response.data.prompt
    prompt = newprompt
  } catch (error) {
    // Handle any errors that occurred during the API call
    console.error('Error:', error);
  }
  //const string = JSON.stringify(data1);
  console,log(prompt)
  const conversation = [
    {
      role: "system",
      //content:"Act as a data extractor, extract the data from various countries Resident ID using AWS textract api. The following data points i.e., ONLY 3 data points needs to be extracted and arrange in a key value pair in JSON format: ‘Resident ID No.’, ‘Issue Date’, ‘Expiry Date’. 'Resident ID No.' which can be termed as ‘National ID’/ ‘Personal No.’/ ‘I.D. No.’/ ‘Civil Number’/ ‘Civil ID No.’/ ‘UID No.’ too. 'Issue Date' which can be termed as ‘Issuing Date’/ ‘Date of Issue’ too. 'Expiry Date' which can be termed as ‘Until Valid’. If Resident ID is not having 'Issue date' e.g., countries like Bahrain, Qatar, Oman, Kuwait etc., then leave output as blank. Don't consider ‘Date of Birth’ as ‘Issue date’.  Expiry Date’ year will be the highest year in the Resident ID.",
      //content:"Act as a data extractor, extract the data from various countries Resident ID using AWS textract api. The text content may vary, and the 'Issue Date' and 'Expiry Date' can appear at different positions within the text. The following data points, ONLY 3, need to be extracted and arranged in a key-value pair in JSON format: 'Resident ID No.', 'Issue Date', and 'Expiry Date'. The 'Resident ID No.' can also be termed as ‘National ID’/ ‘Personal No.’/ ‘I.D. No.’/ ‘Civil Number’/ ‘Civil ID No.’/ ‘UID No.’. The 'Issue Date' can be termed as ‘Issuing Date’/ ‘Date of Issue’. The 'Expiry Date' can be termed as ‘Until Valid’. If a Resident ID does not have an 'Issue Date', especially for countries like Bahrain, Qatar, Oman, Kuwait, etc., then leave the output as blank. Don't consider ‘Date of Birth’ as ‘Issue Date’. The 'Expiry Date' year will be the highest year in the Resident ID. The date format extracted can be either in DD/MM/YYYY or YYYY/MM/DD but should be outputted as DD/MM/YYYY. Your task is to extract and provide them in the following format: Expiry Date: Issue Date: [Issue Date], [Expiry Date]."
      content:`${prompt}`
    },
    { role: "user", 
    content: ` ${data2}` },
    // {
    //   role:"system",
    //   content:`You have a block of text containing information about a residence permit. The text may vary, and the expiry and issue dates can appear at different positions within the text${data2} Your task is to extract the expiry and issue dates from the text. The dates are in the format YYYY/MM/DD.Text: Extract the expiry and issue dates from the text and provide them in the following format:Expiry Date: [Expiry Date]Issue Date: [Issue Date]' fate formate should be DD/MM/YYYY`
    // }
    
    //{role:'system', content:"Make sure that the issue date is **not before** the expiry date. You can use different date formats like YYYY/MM/DD, MM/DD/YYYY, or DD/MM/YYYY:"}
  ];
  const apiUrl = "https://api.openai.com/v1/chat/completions";

  try {
    const response = await axios.post(
      apiUrl,
      {
        model: "gpt-3.5-turbo",
        messages: conversation,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keyforchatgpt}`,
        },
      }
    );

    const data = response.data;
    return data.choices[0].message.content; // Assistant's reply
  } catch (error) {
    console.error("Error calling the ChatGPT API:", error);
    return "An error occurred while processing your request.";
  }
}

// Example usage

// API endpoint to extract key-value pairs from a document using multer for handling FormData
const upload = multer();
app.post(
  "/extract",
  requireApiKey,
  upload.single("document"),
  async (req, res) => {
    try {
      if (!req.file || !req.file.buffer) {
        return res
          .status(400)
          .json({ error: "Missing 'document' field in the request body." });
      }

      const buffer = req.file.buffer;
      const csvData = await extractKeyValuePairsFromDocument(buffer);
      const textData = await extractTextFromDocument(buffer);
      console.log(csvData);
      console.log(textData);
      const jsonData = await callChatGPTAPI(csvData, textData);
      //const data = JSON.parse(jsonData)
      //const result = adjustDates(data);

     // console.log(result);
      if (csvData) {
        console.log(jsonData)
        return res.status(200).send(jsonData);
      } else {
        return res
          .status(404)
          .json({ error: "No key-value pairs found in the document." });
      }
    } catch (error) {
      console.error("Error:", error);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
