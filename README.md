# display
0. ssh into pi through VSCode. command shift p: remote ssh- connect to new host
1. Folder paths are relative to our raspberry pi organization. ```cd display/frontend``` . ```npm install```
2. Run ```npm run dev```
3. Create a new terminal. ```cd clean_dir/ECE_TEST/test_folder```. Run ```python test.py -n 0```. Wait until logs show "success!" and start printing frame counter.
4. Create a new terminal. ```cd display/backend``` 
5. Create venv for packages ```python3 -m venv venv``` (skip if already installed). Then activate ```source venv/bin/activate``` 
6. ```pip install -r requirements.txt``` to get required packaged for backend (skip if already installed)
7. run ```python app.py``` (DO NOT DO THIS BEFORE SEEING TEST.PY SUCCESS)
8. Open ```http://localhost:3000/``` on your computer. Refresh the page if it was already open.
