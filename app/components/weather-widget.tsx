import React from "react";
import styles from "./weather-widget.module.css";

const WeatherWidget = ({
  location = "---",
  temperature = "---",
  conditions = "Sunny",
  isEmpty = false,
}) => {
  const conditionClassMap = {
    Cloudy: styles.weatherBGCloudy,
    Sunny: styles.weatherBGSunny,
    Rainy: styles.weatherBGRainy,
    Snowy: styles.weatherBGSnowy,
    Windy: styles.weatherBGWindy,
  };

  if (isEmpty) {
    return (
      <div>
        <div>
          <p></p>
          <p></p>
        </div>
      </div>
    );
  }

  const weatherClass = `${styles.weatherWidget} ${
    conditionClassMap[conditions] || styles.weatherBGSunny
  }`;

  return (
    <div>
      <div>
        <p></p>
        <h2></h2>
        <p></p>
      </div>
    </div>
  );
};

export default WeatherWidget;
