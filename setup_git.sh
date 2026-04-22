git rm -rf --cached .venv .DS_Store
echo ".venv/" >> .gitignore
echo ".DS_Store" >> .gitignore
git add .gitignore
git commit -m "Deploy configuring, add Dokploy files and basic auth"
git branch -M main
git remote add origin https://github.com/nyimin/myanmar_grid.git
