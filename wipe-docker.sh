#!/bin/bash
# ============================================================
# acumgr — Docker Wipe Script
# Use this to clean up a failed or previous install before
# doing a fresh deployment.
# Usage: chmod +x wipe-docker.sh && sudo ./wipe-docker.sh
# ============================================================
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
echo -e "${YELLOW}[1/5] Stopping containers...${NC}"
docker stop $(docker ps -q) 2>/dev/null || echo "  None running."
echo -e "${YELLOW}[2/5] Removing containers...${NC}"
docker rm -f $(docker ps -aq) 2>/dev/null || echo "  None to remove."
echo -e "${YELLOW}[3/5] Removing images...${NC}"
docker rmi -f $(docker images -q) 2>/dev/null || echo "  None to remove."
echo -e "${YELLOW}[4/5] Pruning volumes...${NC}"
docker volume prune -f
echo -e "${YELLOW}[5/5] Pruning networks...${NC}"
docker network prune -f
echo -e "${GREEN}Done. Ready for fresh install.${NC}"
