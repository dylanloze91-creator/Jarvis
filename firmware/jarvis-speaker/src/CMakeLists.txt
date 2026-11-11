FILE(GLOB_RECURSE app_sources ${CMAKE_SOURCE_DIR}/src/*.c)

idf_component_register(
    SRCS ${app_sources}
    INCLUDE_DIRS "." "../include"
    REQUIRES driver esp_wifi nvs_flash esp_http_client esp_event esp_netif esp_timer esp_driver_usb_serial_jtag esp_driver_gpio
)
