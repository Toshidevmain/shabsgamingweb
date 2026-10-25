# Deploy Shabs Gaming on Render

This project includes a Dockerized PHP 8.3 + MongoDB API and a Vite-built React site. Create a Render **Web Service**, connect the repository, select **Docker**, and set the Dockerfile path to `artifacts/shabs-gaming/Dockerfile`.

Add these environment variables in the Render service settings:

- `MONGODB_URI` — the rotated MongoDB connection string, stored as a secret
- `ADMIN_SETUP_TOKEN` — a long, private one-time code for claiming the owner account
- `MONGODB_DATABASE` — the database name, for example `shabshighlight`, if it is not already present in the connection string

Keep the MongoDB Atlas network access rules limited to the addresses needed by the deployed service. Never commit credentials or paste them into source files. The owner registers through the public sign-up form using the private setup code; the code is accepted only once. Create that account before sharing the public site.

The site stores account, post, comment, and reaction records in MongoDB. Uploaded media is stored in MongoDB GridFS. Images are limited to 15 MB and videos to 100 MB.

The development preview is a Vite frontend. Its PHP API runs in the Docker deployment; production API requests do not use preview data.
