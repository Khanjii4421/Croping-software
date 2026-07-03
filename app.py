import os
import zipfile
import shutil
from flask import Flask, render_template, request, jsonify, send_file, send_from_directory
from werkzeug.utils import secure_filename
from PIL import Image

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['PROCESSED_FOLDER'] = 'processed'
app.config['TEMP_CROP_FOLDER'] = 'temp_crops'
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500 MB max

# Ensure directories exist
for folder in [app.config['UPLOAD_FOLDER'], app.config['PROCESSED_FOLDER'], app.config['TEMP_CROP_FOLDER']]:
    os.makedirs(folder, exist_ok=True)

CROP_SUFFIXES = {
    1: 'R1', 2: 'R2', 3: 'R3', 4: 'R4',
    5: 'L1', 6: 'L2', 7: 'L3', 8: 'L4'
}

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_files():
    if 'files[]' not in request.files:
        return jsonify({'error': 'No files part'}), 400
    
    files = request.files.getlist('files[]')
    saved_files = []
    
    for file in files:
        if file and file.filename.lower().endswith('.gif'):
            filename = secure_filename(file.filename)
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            file.save(filepath)
            saved_files.append(filename)
            
    return jsonify({
        'message': f'Successfully uploaded {len(saved_files)} GIF files.',
        'files': saved_files
    })

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/processed/<filename>')
def processed_file(filename):
    return send_from_directory(app.config['PROCESSED_FOLDER'], filename)

@app.route('/crop', methods=['POST'])
def crop_image():
    data = request.json
    filename = data.get('filename')
    crop_index = data.get('crop_index')
    x = data.get('x')
    y = data.get('y')
    width = data.get('width')
    height = data.get('height')
    
    if not all([filename, crop_index, width, height]):
        return jsonify({'error': 'Missing parameters'}), 400
        
    original_filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    if not os.path.exists(original_filepath):
        return jsonify({'error': 'File not found'}), 404
        
    try:
        with Image.open(original_filepath) as img:
            img = img.convert('RGB')
            cropped_img = img.crop((x, y, x + width, y + height))
            
            base_name = os.path.splitext(filename)[0]
            suffix = CROP_SUFFIXES.get(crop_index)
            if not suffix:
                return jsonify({'error': 'Invalid crop index'}), 400
                
            crop_filename = f"{base_name}{suffix}.png"
            file_temp_dir = os.path.join(app.config['TEMP_CROP_FOLDER'], base_name)
            os.makedirs(file_temp_dir, exist_ok=True)
            
            crop_filepath = os.path.join(file_temp_dir, crop_filename)
            cropped_img.save(crop_filepath, 'PNG')
            
            archive_url = None
            if crop_index == 8:
                archive_filename = f"{base_name}.rar"
                archive_filepath = os.path.join(app.config['PROCESSED_FOLDER'], archive_filename)
                
                with zipfile.ZipFile(archive_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for i in range(1, 9):
                        sux = CROP_SUFFIXES.get(i)
                        c_file = f"{base_name}{sux}.png"
                        c_path = os.path.join(file_temp_dir, c_file)
                        if os.path.exists(c_path):
                            zipf.write(c_path, arcname=c_file)
                            
                shutil.rmtree(file_temp_dir)
                archive_url = f"/processed/{archive_filename}"
                
            return jsonify({
                'message': 'Crop successful',
                'crop_filename': crop_filename,
                'archive_url': archive_url,
                'crop_index': crop_index
            })
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
