# Deployment Guide

## Quick Start

### Local Development

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the application:**
   ```bash
   python app.py
   ```
   Or:
   ```bash
   uvicorn app:app --host 0.0.0.0 --port 8000
   ```

3. **Open browser:**
   Navigate to `http://localhost:8000`

## Cloud Deployment

### Render.com

1. **Create a new Web Service** on Render
2. **Connect your Git repository**
3. Render will automatically detect `render.yaml`:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
4. **Deploy** - Render handles the rest automatically

### Railway

1. **Create a new project** on Railway
2. **Connect your Git repository**
3. Railway detects `Procfile` automatically
4. **Deploy** - Railway sets PORT automatically

### Fly.io

1. **Install Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login:**
   ```bash
   fly auth login
   ```

3. **Launch (creates fly.toml):**
   ```bash
   fly launch
   ```

4. **Deploy:**
   ```bash
   fly deploy
   ```

### Heroku

1. **Install Heroku CLI**
2. **Login:**
   ```bash
   heroku login
   ```

3. **Create app:**
   ```bash
   heroku create your-app-name
   ```

4. **Deploy:**
   ```bash
   git push heroku main
   ```

## Environment Variables

The application uses the `PORT` environment variable (set automatically by most platforms). No additional configuration needed.

## Important Notes

### Before Deployment

1. **Replace clustering logic:** Edit `clustering.py` with your exact clustering implementation
2. **Test locally:** Ensure everything works before deploying
3. **Check CSV format:** Verify your CSV files match the required column names

### Required CSV Columns

- `Latitude` (decimal degrees, -90 to 90)
- `Longitude` (decimal degrees, -180 to 180)
- `Customer Name` (text)
- `Customer Account Number` (unique identifier)

## Troubleshooting

### Static files not loading
- Ensure `static/` directory exists with `index.html`, `styles.css`, and `app.js`
- Check file paths in HTML (should use `/static/` prefix)

### Port binding errors
- Most platforms set `PORT` automatically
- If manual setup needed, use: `uvicorn app:app --host 0.0.0.0 --port $PORT`

### Clustering not working
- Replace `clustering.py` with your exact implementation
- Ensure function signature matches: `cluster_customers(customers: List[Dict]) -> Dict[str, Dict]`

## Testing

Use `sample_data.csv` to test the application:
1. Upload the sample CSV
2. Verify customers appear on map
3. Check clusters are generated
4. Test drawing circles
5. Test export functions
