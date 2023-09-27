const express = require("express");
const fs = require("fs");
const csv = require("csvtojson");
const axios = require("axios");
const {
  TextractClient,
  AnalyzeDocumentCommand,
} = require("@aws-sdk/client-textract");
const AWS = require('aws-sdk');
const multer = require("multer");
const { extractPassportNumbersFromBuffer } = require("./t");
//const { extractPassportInfo } = require("./hjk");
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
AWS.config.update({
  region: "ap-south-1",
  accessKeyId: `${accessKeyId}`,
  secretAccessKey: `${secretAccessKey}`
});
const textract1 = new AWS.Textract();
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
function extractAndFormatDates(elements) {
  let issueDate, expiryDate;

  for (const element of elements) {
    const dateMatches = element.match(/(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}[/-]\d{2}[/-]\d{2})/g);

    if (dateMatches) {
      for (const dateMatch of dateMatches) {
        const [year, month, day] = dateMatch.split(/[/-]/);

        // Check if the date is already in DD/MM/YYYY format
        if (parseInt(day) <= 31 && parseInt(month) <= 12) {
          if (!issueDate) {
            issueDate = dateMatch;
          } else if (!expiryDate) {
            expiryDate = dateMatch;
          }
        } else {
          const formattedDate = `${day}/${month}/${year}`;
          if (!issueDate) {
            issueDate = formattedDate;
          } else if (!expiryDate) {
            expiryDate = formattedDate;
          }
        }
      }
    }
  }

  // Format the dates as DD/MM/YYYY
  const formatAsDDMMYYYY = (date) => {
    const [year, month, day] = date.split(/[/-]/);
    return `${day}/${month}/${year}`;
  };

  // Compare and reorder the dates if necessary
  if (issueDate && expiryDate && new Date(issueDate) > new Date(expiryDate)) {
    const temp = issueDate;
    issueDate = expiryDate;
    expiryDate = temp;
  }

  return {
    IssueDate: issueDate ? formatAsDDMMYYYY(issueDate) : "",
    ExpiryDate: expiryDate ? formatAsDDMMYYYY(expiryDate) : "",
  };
}

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
async function extractTextFromDocument1(fileContent) {
  try {
    // Read the local document file
    //const fileContent = fs.readFileSync(filePath);

    const params = {
      Document: {
        Bytes: fileContent
      }
    };

    const data = await textract1.detectDocumentText(params).promise();

    // Extract text as lines
    const lineText = [];
    for (const block of data.Blocks) {
      if (block.BlockType === 'LINE') {
        lineText.push(block.Text);
      }
    }

    // Join the lines into a single line of text
    const singleLineText = lineText.join('');

    return singleLineText;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
}
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
function findSurnameOrGivenNameOrFirstName(ds1, ds2) {
  let surnameKey = null;
  let givenNameKey = null;
  let firstNameKey = null;
  let name = null;
  let names = null;
  let details = {}

  // Search for keys containing "Surname," "Given Name," or "Name" in ds1
  for (const key in ds1) {
    const lowerKey = key.toLowerCase(); // Convert the key to
    if (lowerKey.includes("surname")) {
      surnameKey = key;
      for (let i = 0; i < ds2.length; i++) {
    if (ds2[i].includes('Surname') && i + 1 < ds2.length) {
      const completeName = ds2[i + 1];
      details["surname"] = ds1[surnameKey]
      //return { surname: ds1[surnameKey] };
      return details
    }}
    } if (lowerKey.includes("given name")) {
      givenNameKey = key;
      for (let i = 0; i < ds2.length; i++) {
     if ((ds2[i].includes('given Name')) && i + 1 < ds2.length) {
     // return { givenname: ds1[givenNameKey] }
      details["givenname"] = ds1[givenNameKey] 
     
      return details
    } }
    } if (lowerKey.includes("first name")) {
        
      firstNameKey = key;
      for (let i = 0; i < ds2.length; i++) {
      if (ds2[i].includes('First Name') && i + 1 < ds2.length) {
      
      //return { firstName: ds1[firstNameKey] };
      details["firstName"] = ds1[firstNameKey] 
      
      return details
    }
  }
    }
     if (lowerKey.includes("name")) {
        
      name = key;
      for (let i = 0; i < ds2.length; i++) {
      if (ds2[i].includes('name') && i + 1 < ds2.length) {
      
      //return { name: ds1[name] };
      details["name"] = ds1[name] 
      
      return details
    }
  }
    }
    if (lowerKey.includes("names")) {
        
      names = key;
      for (let i = 0; i < ds2.length; i++) {
      if (ds2[i].includes('names') && i + 1 < ds2.length) {
      
      //return { name: ds1[name] };
      details["names"] = ds1[names] 
      
      return details
    }
  }
    }
  }

  // If we found a "Surname" key, return its value
  

  // Search for a pattern indicating the start of the corresponding section in ds2
  

  return false; // Neither key nor complete name section found
}
function containsUnitedArabEmirates(arr) {
  return arr.includes('UNITED ARAB EMIRATES');
}
function hasSurnameKey(jsonObject) {
  for (const key in jsonObject) {
      // Check if the key has common indicators of a surname
      if (key.includes('Surname') || key.includes('Last Name') || key.includes('Family Name')) {
          return true;
      }
  }
  return false;
}
async function callChatGPTAPI(data1, data2) {
   const apiUrl1 = 'https://testapi.io/api/avina/prompt';
   let prompt = "djdjd"
  try {
    const response = await axios.get(apiUrl1);
    // Handle the API response data here
   
    const newprompt = response.data.prompt
    prompt = newprompt
  } catch (error) {
    // Handle any errors that occurred during the API call
    console.error('Error:', error);
  }
  //const string = JSON.stringify(data1);
  console.log(prompt)
  const conversation = [
    {
      role: "system",
      //content:"Act as a data extractor, extract the data from various countries Resident ID using AWS textract api. The following data points i.e., ONLY 3 data points needs to be extracted and arrange in a key value pair in JSON format: ‘Resident ID No.’, ‘Issue Date’, ‘Expiry Date’. 'Resident ID No.' which can be termed as ‘National ID’/ ‘Personal No.’/ ‘I.D. No.’/ ‘Civil Number’/ ‘Civil ID No.’/ ‘UID No.’ too. 'Issue Date' which can be termed as ‘Issuing Date’/ ‘Date of Issue’ too. 'Expiry Date' which can be termed as ‘Until Valid’. If Resident ID is not having 'Issue date' e.g., countries like Bahrain, Qatar, Oman, Kuwait etc., then leave output as blank. Don't consider ‘Date of Birth’ as ‘Issue date’.  Expiry Date’ year will be the highest year in the Resident ID.",
      //content:"Act as a data extractor, extract the data from various countries Resident ID using AWS textract api. The text content may vary, and the 'Issue Date' and 'Expiry Date' can appear at different positions within the text. The following data points, ONLY 3, need to be extracted and arranged in a key-value pair in JSON format: 'Resident ID No.', 'Issue Date', and 'Expiry Date'. The 'Resident ID No.' can also be termed as ‘National ID’/ ‘Personal No.’/ ‘I.D. No.’/ ‘Civil Number’/ ‘Civil ID No.’/ ‘UID No.’. The 'Issue Date' can be termed as ‘Issuing Date’/ ‘Date of Issue’. The 'Expiry Date' can be termed as ‘Until Valid’. If a Resident ID does not have an 'Issue Date', especially for countries like Bahrain, Qatar, Oman, Kuwait, etc., then leave the output as blank. Don't consider ‘Date of Birth’ as ‘Issue Date’. The 'Expiry Date' year will be the highest year in the Resident ID. The date format extracted can be either in DD/MM/YYYY or YYYY/MM/DD but should be outputted as DD/MM/YYYY. Your task is to extract and provide them in the following format: Expiry Date: Issue Date: [Issue Date], [Expiry Date]."
      content:`${prompt}`
    },
    { role: "user", 
    content: ` data Source DS1-${data1} and data Source DS2-${data2}` },
    
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
      const jsonData = await callChatGPTAPI(csvData, textData);
      console.log(csvData);
      console.log(textData);
      //console.log(a)
      const lightData = JSON.parse(jsonData)
      //---------------------------------------------------
      // if(containsUnitedArabEmirates(textData)==true)
      // {
      //   const last10Elements = textData.slice(-10);
      //  const realData =  extractAndFormatDates(last10Elements)
      //  console.log(realData)
      //  console.log(lightData)
      //  lightData["Issue Date"] = realData.IssueDate
      //  lightData["Expiry Date"] = realData.ExpiryDate
      // }
      //-----------------------------------------------
      const checkValue = findSurnameOrGivenNameOrFirstName(csvData, textData)
      if(checkValue != false)
      {
        if(checkValue.hasOwnProperty("surname"))
        {
          lightData["Surname"] = checkValue["surname"]
        }if(checkValue.hasOwnProperty("givenname"))
        {
          lightData["Given Name"] = checkValue["givenname"]
        }
        if(checkValue.hasOwnProperty("firstName"))
        {
          lightData["Given Name"] = checkValue["firstName"]
        }
        if(checkValue.hasOwnProperty("name"))
        {
          lightData["Given Name"] = checkValue["name"]
        }
        
      }
     // console.log(result);
      if (csvData) {
        console.log(jsonData)
        return res.status(200).send(lightData);
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
