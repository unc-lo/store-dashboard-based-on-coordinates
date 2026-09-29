# CCBA Audit Map

A cloud-hosted, browser-based mapping application for visualizing customer coordinates and clusters.

## Features

- 📤 **CSV Upload**: Upload CSV files with customer coordinates
- 🗺️ **Interactive Map**: OpenStreetMap-based visualization
- 🟢 **Cluster Visualization**: Display pre-computed clusters as areas
- 📍 **Customer Points**: Individual markers for each customer
- 🎨 **Visual Customization**: Change colors, rename areas
- ⭕ **Manual Drawing**: Draw custom circles to define areas
- 🔍 **Filters**: Toggle visibility of overlays and indicators
- 📤 **Export**: Export map as HTML or data as CSV

## Requirements

- Python 3.11+
- Required columns in CSV:
  - `Latitude`
  - `Longitude`
  - `Customer Account Number`
  - `Customer Account Name`

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

3. Open your browser to `http://localhost:8000`

## Deployment

### Render

1. Push your code to a Git repository
2. Create a new Web Service on Render
3. Connect your repository
4. Render will automatically detect the `render.yaml` configuration

### Railway

1. Push your code to a Git repository
2. Create a new project on Railway
3. Connect your repository
4. Railway will automatically detect the `Procfile`

### Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Run: `fly launch`
3. Deploy: `fly deploy`

## Important Notes

### Clustering Logic

The clustering logic is located in `clustering.py`. **If you have existing clustering code, replace the functions in this module with your exact implementation.** The current implementation is a placeholder that demonstrates the expected interface.

Key functions to replace:
- `cluster_customers()`: Your exact clustering algorithm
- `haversine_distance()`: Your distance calculation (if different)

**Preserve all thresholds, distance calculations, and grouping rules from your existing code.**

## Project Structure

```
.
├── app.py                 # FastAPI backend application
├── clustering.py          # Clustering logic (REPLACE WITH YOUR CODE)
├── requirements.txt      # Python dependencies
├── static/
│   ├── index.html        # Main HTML page
│   ├── styles.css        # CSS styles
│   └── app.js           # Frontend JavaScript
├── render.yaml           # Render deployment config
├── Procfile              # Railway/Heroku deployment config
└── README.md            # This file
```

## Usage

1. **Upload CSV**: Click "Upload CSV" and select your file
2. **View Map**: Customer points and clusters will appear on the map
3. **Customize**: 
   - Click customer points or clusters to change colors
   - Rename clusters/areas from the sidebar or popups
   - Draw circles to create custom areas
4. **Filter**: Use sidebar checkboxes to toggle overlays
5. **Export**: Export map as HTML or data as CSV

## Data Integrity

- Customer Account Number is the primary key
- No automatic area detection or inference
- No routing or visit optimization
- All visual changes are non-destructive

## Browser Compatibility

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## License

MIT
