# Geospatial Analysis of Traffic-Related Air Pollutant Emissions

<p align="center">
  <a href="https://www.uniss.it/">
    <img src="Tesi/foto/logo_uniss_versione_base_orizzontale_sfondo_trasparente_0.png" alt="University of Sassari (UNISS) logo" width="360">
  </a>
</p>

This repository contains the software and thesis for a Bachelor's degree in Computer Engineering at the University of Sassari (UNISS). The project explores how traffic counts collected by road cameras can be processed, used to estimate vehicle-related emissions, and visualized geographically.

**Project type:** Bachelor's thesis and web application  
**Thesis title:** *Geospatial Analysis of Traffic-Related Pollutant Emissions*  
**Original thesis language:** Italian

## Project Overview

The application provides an interactive map for exploring traffic data and estimated emissions by camera location and time period. It imports camera count files, aggregates observations in a MySQL/MariaDB database, and exposes the resulting data through PHP endpoints. The browser-based interface uses the selected vehicle class, pollutant, and emission factors to update the map and related visualizations.

Emission values are model-based estimates derived from traffic counts, emission factors, and the road-segment length associated with each camera. They are intended for comparative analysis and are not direct measurements of ambient air quality.

## Main Features

- Import traffic count data from CSV and TXT files.
- Store camera metadata and aggregated traffic intervals in MySQL/MariaDB.
- Explore camera locations and traffic or estimated-emission values on an interactive map.
- Filter data by date, date range, and location.
- Compare vehicle classes and emission-factor categories.
- Inspect saved data with charts and a daily playback view.

## Architecture and Technologies

- **Frontend:** HTML5, CSS3, and JavaScript ES modules.
- **Mapping:** Leaflet with OpenStreetMap tiles.
- **Charts and data parsing:** Chart.js and Papa Parse.
- **Backend:** PHP APIs using PDO.
- **Database:** MySQL/MariaDB.
- **Thesis:** LaTeX, with figures and the UNISS logo in `Tesi/foto/`.

## Repository Contents

- `index.html`, `style.css`, `panel.html`, and `panel.css`: main application interface.
- `js/`: map, metrics, charts, saved-data views, and upload interface modules.
- `api/`: PHP endpoints for camera data, upload status, file imports, and emission factors.
- `Tesi/main.tex`: thesis source.
- `Tesi.pdf`: compiled thesis for convenient reading.
- `Tesi/foto/`: thesis figures and the UNISS logo used by this README.

## Running the Application

The application requires a PHP-enabled web server with PDO MySQL support and a MySQL/MariaDB database containing the tables expected by the API. This repository does not currently include a database schema, seed data, or an automated database setup script, so those must be prepared separately before the API can return application data.

The PHP files currently use local development database settings (`127.0.0.1`, database `traffico`, user `root`, and an empty password). Update the connection settings in the API files to match your local environment before running the application. Do not use these development settings in a deployed environment.

From the repository root, start PHP's built-in server for local testing:

```sh
php -S 127.0.0.1:8000
```

Open `http://127.0.0.1:8000`. The frontend also loads Leaflet, Papa Parse, and Chart.js from external CDNs, so an internet connection is required for those libraries and the map tiles.

## Building the Thesis

The committed `Tesi.pdf` is ready to read. To compile the LaTeX source, install a LaTeX distribution with the packages used in `Tesi/main.tex`, then run the following command twice from the `Tesi/` directory so the table of contents is updated:

```sh
pdflatex main.tex
pdflatex main.tex
```

## Academic Disclaimer

This work was developed as an undergraduate thesis in Computer Engineering at the University of Sassari. The repository is provided for academic and portfolio purposes. Please verify the usage rights for any datasets, third-party materials, and university branding before redistributing or reusing them. The presence of the UNISS logo identifies the academic context and does not imply institutional endorsement of this software.