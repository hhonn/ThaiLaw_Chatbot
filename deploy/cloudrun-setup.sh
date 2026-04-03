#!/usr/bin/env bash
# One-time setup for Google Cloud Run deployment.
# Run this ONCE before the first `gcloud builds submit`.
#
# Requirements:
#   gcloud CLI installed and authenticated (`gcloud auth login`)
#   PROJECT_ID set to your GCP project
#
# Usage:
#   export PROJECT_ID=your-gcp-project-id
#   export REGION=asia-southeast1
#   bash deploy/cloudrun-setup.sh

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID env var}"
REGION="${REGION:-asia-southeast1}"
BUCKET="lawbot-data-${PROJECT_ID}"

echo "==> Project: $PROJECT_ID  Region: $REGION"

# 1. Enable required APIs
echo "==> Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  containerregistry.googleapis.com \
  --project="$PROJECT_ID"

# 2. Create GCS bucket for SQLite persistence
# Cloud Run mounts this as a FUSE volume so SQLite files persist across restarts.
echo "==> Creating GCS bucket: $BUCKET"
if ! gsutil ls -b "gs://$BUCKET" &>/dev/null; then
  gsutil mb -p "$PROJECT_ID" -l "$REGION" -b on "gs://$BUCKET"
  echo "    Bucket created."
else
  echo "    Bucket already exists, skipping."
fi

# 3. Store secrets in Secret Manager
# Each secret is created empty; you set the actual value manually.
echo ""
echo "==> Creating secrets in Secret Manager..."
echo "    You will need to set the actual values after creation."
echo ""

create_secret() {
  local name="$1"
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo "    Secret '$name' already exists, skipping."
  else
    gcloud secrets create "$name" \
      --replication-policy=automatic \
      --project="$PROJECT_ID"
    echo "    Secret '$name' created."
  fi
}

create_secret "TYPHOON_API_KEY"
create_secret "SMTP_PASSWORD"
create_secret "ANALYTICS_ADMIN_KEY"
create_secret "SMTP_EMAIL"

# 4. Set secret values (prompts for each)
echo ""
echo "==> Setting secret values (paste value, then press Enter):"

set_secret() {
  local name="$1"
  echo -n "    $name: "
  read -rs value
  echo
  printf '%s' "$value" | gcloud secrets versions add "$name" \
    --data-file=- \
    --project="$PROJECT_ID"
  echo "    '$name' stored."
}

set_secret "TYPHOON_API_KEY"
set_secret "SMTP_PASSWORD"
set_secret "ANALYTICS_ADMIN_KEY"
set_secret "SMTP_EMAIL"

# 5. Grant Cloud Build access to secrets
echo ""
echo "==> Granting Cloud Build service account access to secrets..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
CR_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SA in "$CB_SA" "$CR_SA"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

# Grant Cloud Run service account access to GCS bucket
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$CR_SA" \
  --role="roles/storage.objectAdmin"

# 6. Grant Cloud Build permission to deploy Cloud Run
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CB_SA" \
  --role="roles/run.admin" \
  --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$CB_SA" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

echo ""
echo "==> Setup complete!"
echo ""
echo "Next: trigger your first build:"
echo "  gcloud builds submit . \\"
echo "    --config=cloudbuild.yaml \\"
echo "    --project=$PROJECT_ID \\"
echo "    --substitutions=_REGION=$REGION,_BACKEND_SERVICE=lawbot-backend,_FRONTEND_SERVICE=lawbot-frontend"