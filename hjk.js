function extractPassportInfo(passportData) {
    const patterns = {
        passportNumber: /Passport No/,
        givenName: /Given Name/,
        surName: /Surname/,
        dateOfBirth: /Date of Birth/,
        placeOfIssue: /Place of Issue/,
        dateOfIssue: /Date of Issue/,
        dateOfExpiry: /Date of Expiry/,
        gender: /Sex/,
        nationality: /Nationality/,
        placeOfBirth: /Place of Birth/,
    };
    const extractedInfo = {};

    // Define a regular expression pattern to extract key-value pairs
    const keyValuePattern = /"([^"]+)": "([^"]*)"/g;

    // Extract key-value pairs using regular expressions
    let matches;
    while ((matches = keyValuePattern.exec(passportData))) {
        const key = matches[1].trim();
        const value = matches[2].trim();
        for (const infoKey in patterns) {
            const pattern = patterns[infoKey];
            if (key.match(pattern)) {
                if (["dateOfBirth", "dateOfIssue", "dateOfExpiry"].includes(infoKey)) {
                    extractedInfo[infoKey] = value.replace(/\//g, '-');
                } else {
                    extractedInfo[infoKey] = value;
                }
                break;
            }
        }
    }

    return extractedInfo;
}

// Sample data (as a string)


// Define the patterns for the fields


// Extract information using the function
module.exports = {
    extractPassportInfo
}