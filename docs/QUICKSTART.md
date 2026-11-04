# Getting started

## 1. Install Node.js

Install Node.js from [nodejs.org](https://nodejs.org/en/download).
Node.js 22 or newer is recommended. Then open a new terminal and check:

```text
node --version
```

If you get a version number, you are ready. If the command is not found, reopen
the terminal after installing Node.js.

## 2. Get the script

On the repository page, open **gallery.js** and use **Download raw file**.
Save it as `gallery.js`, rather than `gallery.js.txt`.

Alternatively, choose **Code → Download ZIP**, extract it, and find `gallery.js`.
Only that one file is needed to run the gallery; the other files are instructions,
tests and project metadata. There is no `npm install` step.

Copy `gallery.js` into the folder containing your photos and subfolders. Keep
this folder limited to media you want to browse or share.

## 3. Start the gallery

### Windows

Open the image folder in File Explorer. Type `powershell` in its address bar
and press Enter. Then run:

```powershell
node .\gallery.js
```

### Linux or macOS

Open a terminal in the folder containing the script, then run:

```bash
node gallery.js
```

You can also keep the script elsewhere and pass the image folder as an argument:

```text
node gallery.js "/path/to/photos"
```

For example, in Windows PowerShell:

```powershell
node .\gallery.js "D:\My Photos"
```

## 4. Open your browser

Go to **http://127.0.0.1:4180** on the same computer. Leave the terminal running
while you browse. Press **Ctrl+C** in the terminal when you want to stop.

Each folder with media appears as its own gallery. Files directly alongside the
script appear under **Main folder**. Nested folders are separate galleries.

- Use the search box to find a folder.
- Turn file types on or off, or use **Clear** and select just one type.
- Choose a sort order; gallery pages contain up to 30 files.
- Select a picture to view it. Use arrows to navigate, or zoom and drag to pan.
- Select a WebM tile, then press Play. Only the selected video can play.
- Choose **Info**, or press **I**, to inspect the selected file.
- Press **Escape** to close the viewer.
- After adding or moving files, choose **Refresh folders**.

## 5. View from another device (optional)

Stop the script with Ctrl+C and start it again with:

```text
node gallery.js --host 0.0.0.0
```

The terminal prints one or more **Network:** addresses. On another computer,
tablet or phone on the same network, open one of those addresses, for example
`http://192.168.1.50:4180`.

Use the hosting computer's IP address, not `0.0.0.0` or `127.0.0.1`. If asked by
Windows Firewall, allow Node.js on your **Private** network. Other firewalls need
to allow incoming TCP traffic to port 4180 from the local network.

Network mode has no password. Use it on a trusted home network and do not forward
the port on your router. See the [README](../README.md#access-from-another-computer)
for more network details.

## Updating

1. Stop the running script with Ctrl+C.
2. Replace `gallery.js` with the newer version.
3. Run the same command again and refresh the browser.

Updating the script does not alter your media. If your browser still shows the
old interface, try a hard refresh (Ctrl+Shift+R, or Cmd+Shift+R on macOS).
