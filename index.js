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
  // res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
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
  //const string = JSON.stringify(data1);

  const conversation = [
    {
      role: "system",
      // content:
      //   "You are a data extractor or arranger. You receive input extracted from the Amazon TextExtract using forms API, which provides data in key-value pairs. The required data points are: Passport No., Given Name, SurName, DOB, Place of Issue, Issue Date, Expiry Date, Gender, Nationality, Place of Birth. The data may vary based on the country's format. Please provide only this key-value data in JSON format.",
      content:"You are a data extractor or arranger. You receive input extracted from various country's ID recognition systems using forms API, which provides data in key-value pairs. The required data points are: Resident ID, Issue Date, Expiry Date. The data may vary based on the country's format. Please provide only this key-value data in JSON format. please dont take dob or date of birth to issue date or expiy date and if date in the formate of YYYY/MM/DD compare date issue date and expiry date issue date is always before expiry date compare and return response accordingly response should be in original formate  "
    },
    { role: "user", content: `${data1}, ${data2}` },
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
      console.log(jsonData);
      if (csvData) {
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
