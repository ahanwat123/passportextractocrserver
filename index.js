const express = require("express");
const fs = require("fs");
const csv = require("csvtojson");
const {
  TextractClient,
  AnalyzeDocumentCommand,
} = require("@aws-sdk/client-textract");
const multer = require("multer");
const { extractPassportNumbersFromBuffer } = require("./t");
const {extractPassportInfo} = require("./hjk")


const app = express();
const PORT = process.env.PORT || 4000;

// Replace these values with your actual AWS credentials
const awsConfig = {
  credentials: {
    accessKeyId: "AKIA3RJI62MG2UEHKD5M",
    secretAccessKey: "HkCTEzb4oschdi+AbDeOCmeIOXcDp8t6VzAKdX6n",
  },
  region: "ap-south-1",
};

const textract = new TextractClient(awsConfig);

// Middleware to parse JSON and handle potential errors
app.use(express.json());

// Middleware for CORS (Cross-Origin Resource Sharing)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000"); // Replace with the allowed domain
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

// Utility function to process CSV data
async function process_data(csvData) {
  try {
    const jsonArray = await csv().fromString(csvData);
    const cleanedData = jsonArray.reduce((result, item) => {
      const key = item["Key"];
      const value = item["Value"];
      result[key.trim()] = value.trim();
      return result;
    }, {});

    // Convert to JSON format before returning
    const jsonData = JSON.stringify(cleanedData, null, 2);
    return jsonData;
  } catch (error) {
    console.error("Error converting CSV to JSON:", error.message);
    throw error;
  }
}
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
      let csvData = "Key,Value\n";
      Object.entries(keyValues).forEach(([key, value]) => {
        csvData += `${key},${value}\n`;
      });

      return csvData;
    }

    // In case no blocks are found, return undefined
    return undefined;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

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
      const passportNumbers = await extractPassportNumbersFromBuffer(buffer);
      console.log(passportNumbers);
      if (csvData) {
        const jsonData = await process_data(csvData);
        
        const mainData = JSON.parse(jsonData)
        //mainData["passportNumber"] = passportNumbers[0]
        console.log(mainData)
        const singledata = extractPassportInfo(jsonData)
        console.log(singledata)
        return res.status(200).send(singledata);
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
