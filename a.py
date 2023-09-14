import pytesseract
from PIL import Image

# Set the correct Tesseract executable path
pytesseract.pytesseract.tesseract_cmd = '/usr/bin/tesseract'

def extract_arabic_text(image_path):
    try:
        # Open the image using Pillow
        image = Image.open(image_path)
        
        # Perform OCR to extract text
        extracted_text = pytesseract.image_to_string(image, lang='ara')

        return extracted_text
    except Exception as e:
        print(f"An error occurred: {e}")
        return None

# Replace 'your_image.png' with the actual image file path
image_path = './arabic.jpeg'

# Extract Arabic text from the image
arabic_text = extract_arabic_text(image_path)

if arabic_text:
    print("Extracted Arabic Text:")
    print(arabic_text)
else:
    print("Text extraction failed.")
