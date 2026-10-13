"""Development entry point: ``python run.py`` serves the API on http://127.0.0.1:5000."""
import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(host=os.getenv("SMARTLAB_HOST", "127.0.0.1"), port=int(os.getenv("SMARTLAB_PORT", "5000")),
            debug=os.getenv("FLASK_DEBUG") == "1", threaded=True)
