/**
 * dashboard-simple-test.js
 * Script test đơn giản cho dashboard bao gồm:
 * - Tương tác với các nút chế độ (stop/manual/legacy/auto)
 * - Kéo thanh trượt góc lái
 * - Hiển thị camera trong khung màu đỏ với kết nối WebSocket từ Jetson Nano
 * - Gửi lệnh điều khiển đến Jetson thông qua WebSocket
 */

// Global variables cho kết nối Jetson Camera
let ws = null;
let isConnected = false;
let frameCount = 0;
let lastFrameTime = 0;
let fpsArray = [];
let serverIP = "192.168.73.112"; // Mặc định IP, sẽ thay đổi được
let serverPort = 8765; // Mặc định port, sẽ thay đổi được
let streamActive = false;
let currentMode = ""; // Biến lưu chế độ hiện tại (stop, manual, legacy, auto)

document.addEventListener('DOMContentLoaded', function() {
    console.log("Dashboard Test đơn giản đã khởi động");
    
    // ===== PHẦN 1: KIỂM TRA CÁC NÚT CHẾ ĐỘ =====
    
    // Tìm các nút chế độ
    const buttons = {
        stop: document.querySelector('.button, #stop'),
        manual: document.querySelector('.button3, #manual'),
        legacy: document.querySelector('.button5, #legacy'),
        auto: document.querySelector('.button6, #auto')
    };
    
    console.log("Đã tìm thấy các nút:", {
        stop: !!buttons.stop,
        manual: !!buttons.manual,
        legacy: !!buttons.legacy,
        auto: !!buttons.auto
    });
    
    // Gắn sự kiện click cho các nút và gửi lệnh đến Jetson
    if (buttons.stop) {
        buttons.stop.addEventListener('click', function() {
            resetAllButtons(buttons);
            setActiveButton(buttons.stop);
            sendCommandToJetson("stop");
            currentMode = "stop";
            console.log("Stop mode activated");
        });
    }
    
    if (buttons.manual) {
        buttons.manual.addEventListener('click', function() {
            resetAllButtons(buttons);
            setActiveButton(buttons.manual);
            sendCommandToJetson("manual");
            currentMode = "manual";
            console.log("Manual mode activated");
        });
    }
    
    if (buttons.legacy) {
        buttons.legacy.addEventListener('click', function() {
            resetAllButtons(buttons);
            setActiveButton(buttons.legacy);
            sendCommandToJetson("legacy");
            currentMode = "legacy";
            console.log("Legacy mode activated");
        });
    }
    
    if (buttons.auto) {
        buttons.auto.addEventListener('click', function() {
            resetAllButtons(buttons);
            setActiveButton(buttons.auto);
            sendCommandToJetson("auto");
            currentMode = "auto";
            console.log("Auto mode activated");
        });
    }
    
    // Đảm bảo tất cả các nút đều có màu trắng và chữ đen từ đầu
    resetAllButtons(buttons);
    console.log("Đã đặt tất cả các nút về trạng thái mặc định");
    
    // ===== PHẦN 2: THIẾT LẬP THANH TRƯỢT GÓC LÁI =====
    setupSteeringSlider();
    
    // ===== PHẦN 3: THIẾT LẬP CAMERA =====
    setupJetsonCamera();
    
    // ===== PHẦN 4: THIẾT LẬP TRẠNG THÁI PIN =====
    setupBatteryStatusRectangles();
    
    // ===== PHẦN 5: THIẾT LẬP ĐỒNG HỒ TỐC ĐỘ =====
    setupSpeedGauge();
});

// Đặt nút thành active (màu đen, chữ trắng)
function setActiveButton(button) {
    if (!button) return;
    
    // Đặt màu nền đen và text màu trắng
    button.style.backgroundColor = '#111111';
    
    // Tìm phần tử text bên trong
    const textElement = button.querySelector('div') || button;
    if (textElement) {
        textElement.style.color = '#FFFFFF';
    }
}

// Reset tất cả các nút về màu trắng
function resetAllButtons(buttons) {
    for (const key in buttons) {
        const button = buttons[key];
        if (button) {
            // Đặt màu nền trắng và text màu đen
            button.style.backgroundColor = '#FFFFFF';
            
            // Tìm phần tử text bên trong
            const textElement = button.querySelector('div') || button;
            if (textElement) {
                textElement.style.color = '#000000';
            }
        }
    }
}

// Thiết lập thanh trượt góc lái
function setupSteeringSlider() {
    const CONFIG = {
        maxSteerAngle: 23  // Giá trị tối đa sau khi chuyển đổi từ server (-23 đến 23)
    };

    // Tìm các phần tử UI
    const slider = document.querySelector('.range-selection-slider');
    const angleValue = document.querySelector('.angle');

    if (!slider) {
        console.warn("Không tìm thấy thanh trượt góc lái");
        return;
    }

    // Ẩn phần hiển thị angle nếu có
    if (angleValue) {
        angleValue.style.display = 'none';
    }

    // Tạo container cho cả hai handles di chuyển cùng nhau
    const handleContainer = document.querySelector('.steering-handles') || document.createElement('div');
    if (!handleContainer.parentNode) {
        handleContainer.className = 'steering-handles';
        const handleLeft = document.createElement('div');
        handleLeft.className = 'handle-left';
        const handleRight = document.createElement('div');
        handleRight.className = 'handle-right';
        handleContainer.appendChild(handleLeft);
        handleContainer.appendChild(handleRight);
        slider.appendChild(handleContainer);
    }

    // Tạo điểm đánh dấu vị trí trung tâm (góc 0)
    const centerMark = document.querySelector('.center-mark') || document.createElement('div');
    centerMark.className = 'center-mark';
    if (!centerMark.parentNode) slider.appendChild(centerMark);

    // Tạo điểm đánh dấu min và max
    const minMark = document.querySelector('.min-mark') || document.createElement('div');
    minMark.className = 'min-mark';
    if (!minMark.parentNode) slider.appendChild(minMark);

    const maxMark = document.querySelector('.max-mark') || document.createElement('div');
    maxMark.className = 'max-mark';
    if (!maxMark.parentNode) slider.appendChild(maxMark);

    // Đặt vị trí ban đầu của container handles tại giữa slider
    handleContainer.style.left = '50%';
    handleContainer.style.position = 'absolute';
    handleContainer.style.display = 'flex';
    handleContainer.style.alignItems = 'center';

    // Biến global để lưu giá trị góc hiện tại
    window.currentSteerAngle = 0;

    // Cập nhật thanh trượt từ giá trị steer của server
    function updateSteeringFromServer(steer) {
        const normalizedSteer = Math.min(Math.max(steer, -CONFIG.maxSteerAngle), CONFIG.maxSteerAngle);
        updateSteeringUI(normalizedSteer, handleContainer, CONFIG.maxSteerAngle);
    }

    // Lắng nghe dữ liệu từ WebSocket để cập nhật steer
    window.updateSteeringFromServer = updateSteeringFromServer; // Để sử dụng trong connectToJetson

    // Loại bỏ các sự kiện điều khiển trực tiếp - chỉ hiển thị thông tin từ Jetson
    console.log("Thiết lập góc lái - chỉ chế độ hiển thị, không điều khiển");
    
    // Slider sẽ chỉ hiển thị, không tương tác
    slider.style.pointerEvents = 'none';
    
    // Giao diện cập nhật chỉ từ dữ liệu Jetson gửi về

    // Thiết lập vị trí ban đầu
    updateSteeringUI(0, handleContainer, CONFIG.maxSteerAngle);
}

// Cập nhật UI góc lái
function updateSteeringUI(angle, handleContainer, maxAngle) {
    // Tính phần trăm vị trí dựa trên giá trị angle (-maxAngle đến +maxAngle)
    const percentage = (angle + maxAngle) / (2 * maxAngle) * 100; // Chuyển từ -maxAngle~maxAngle thành 0%~100%
    console.log("Updating steer UI: angle =", angle, "percentage =", percentage);

    // Cập nhật vị trí của container handles
    if (handleContainer) {
        handleContainer.style.left = `calc(50% + ${percentage - 50}%)`; // Di chuyển từ trung tâm, -50% đến +50%
        window.currentSteerAngle = angle;
        console.log("Updated handle position to:", handleContainer.style.left);
    } else {
        console.warn("handleContainer not found");
    }
}

// Đã loại bỏ hàm sendSteerValueToJetson() vì không còn điều khiển từ giao diện

// Thiết lập camera từ Jetson Nano qua WebSocket
function setupJetsonCamera() {
    const cameraContainer = document.querySelector('.rectangle-13');
    if (!cameraContainer) {
        console.warn("Không tìm thấy khung đen để hiển thị camera");
        return;
    }

    console.log("Đã tìm thấy khung camera:", cameraContainer);

    const cameraInterfaceContainer = document.createElement('div');
    cameraInterfaceContainer.className = 'jetson-camera-container';
    cameraContainer.style.position = 'fixed';

    const videoElement = document.createElement('img');
    videoElement.id = 'jetsonVideoStream';
    videoElement.className = 'jetson-video-stream';
    videoElement.alt = 'Jetson Camera Stream';
    videoElement.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const statusElement = document.createElement('div');
    statusElement.id = 'connectionStatus';
    statusElement.className = 'connection-status-indicator disconnected';
    statusElement.textContent = 'Not connected';

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'camera-controls';

    const connectButton = document.createElement('button');
    connectButton.id = 'connectJetsonBtn';
    connectButton.className = 'camera-control-btn connect-btn';
    connectButton.textContent = 'Connect';

    const disconnectButton = document.createElement('button');
    disconnectButton.id = 'disconnectJetsonBtn';
    disconnectButton.className = 'camera-control-btn disconnect-btn';
    disconnectButton.textContent = 'Disconnect';
    disconnectButton.disabled = true;

    controlsContainer.appendChild(connectButton);
    controlsContainer.appendChild(disconnectButton);

    const statsContainer = document.createElement('div');

    cameraInterfaceContainer.appendChild(videoElement);
    cameraInterfaceContainer.appendChild(statusElement);
    cameraInterfaceContainer.appendChild(controlsContainer);
    cameraInterfaceContainer.appendChild(statsContainer);

    cameraContainer.appendChild(cameraInterfaceContainer);

    connectButton.addEventListener('click', function() {
        showConnectionDialog();
    });

    disconnectButton.addEventListener('click', function() {
        disconnectFromJetson();
    });

    window.addEventListener('beforeunload', function() {
        if (isConnected && ws) {
            ws.close();
        }
    });
}

// Hiển thị dialog nhập thông tin kết nối
function showConnectionDialog() {
    const dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'dialog-overlay';

    const dialogContainer = document.createElement('div');
    dialogContainer.className = 'dialog-container';

    dialogContainer.innerHTML = `
        <h3>Connect to Jetson Nano</h3>
        <div class="dialog-form">
            <div class="dialog-form-group">
                <label for="jetsonIp">Địa chỉ IP:</label>
                <input type="text" id="jetsonIp" value="${serverIP}" placeholder="Nhập IP (vd: 192.168.1.100)">
            </div>
            <div class="dialog-form-group">
                <label for="jetsonPort">Cổng kết nối:</label>
                <input type="number" id="jetsonPort" value="${serverPort}" placeholder="Nhập Port (vd: 8765)">
            </div>
            <div class="dialog-buttons">
                <button id="dialogCancelBtn">Cancel</button>
                <button id="dialogConnectBtn">Connect</button>
            </div>
        </div>
    `;

    dialogOverlay.appendChild(dialogContainer);
    document.body.appendChild(dialogOverlay);

    document.getElementById('dialogCancelBtn').addEventListener('click', function() {
        document.body.removeChild(dialogOverlay);
    });

    document.getElementById('dialogConnectBtn').addEventListener('click', function() {
        const ipInput = document.getElementById('jetsonIp');
        const portInput = document.getElementById('jetsonPort');

        serverIP = ipInput.value || 'localhost';
        serverPort = parseInt(portInput.value) || 8765;

        document.body.removeChild(dialogOverlay);
        connectToJetson(serverIP, serverPort);
    });
}

// Kết nối đến Jetson Nano qua WebSocket
function connectToJetson(ip, port) {
    document.getElementById('connectJetsonBtn').disabled = true;
    document.getElementById('connectionStatus').textContent = 'Connecting...';
    document.getElementById('connectionStatus').className = 'connection-status-indicator connecting';

    ws = new WebSocket(`ws://${ip}:${port}`);

    ws.onopen = function() {
        isConnected = true;
        streamActive = true;

        document.getElementById('connectionStatus').textContent = 'Connected';
        document.getElementById('connectionStatus').className = 'connection-status-indicator connected';
        document.getElementById('connectJetsonBtn').disabled = true;
        document.getElementById('disconnectJetsonBtn').disabled = false;

        console.log("WebSocket connected to Jetson Nano");
        
        // Nếu trước đó đã chọn một chế độ, gửi lại lệnh đó khi kết nối thành công
        if (currentMode) {
            sendCommandToJetson(currentMode);
            console.log(`Đã gửi lại lệnh chế độ: ${currentMode}`);
        }
    };

    ws.onclose = function() {
        handleJetsonDisconnect();
    };

    ws.onerror = function(error) {
        console.error("WebSocket error:", error);
        handleJetsonDisconnect();
    };

    ws.onmessage = function(e) {
        try {
            const receiveTime = performance.now();
            const data = JSON.parse(e.data);
            const imageData = data.image;
            const timestamp = data.timestamp;
            const rawSpeed = data.speed || 0;
            const rawSteer = data.steer || 0;

            // Hiển thị hình ảnh
            const videoElement = document.getElementById('jetsonVideoStream');
            if (videoElement) {
                videoElement.src = "data:image/jpeg;base64," + imageData;
            }

            // Cập nhật tốc độ sau khi chuyển đổi
            if (rawSpeed !== undefined) {
                const displaySpeed = convertJetsonSpeed(rawSpeed);
                updateSpeedUI(displaySpeed, document.querySelector('.ellipse-16'), document.querySelector('._57'), 50);
            }

            // Cập nhật góc lái sau khi chuyển đổi
            if (rawSteer !== undefined) {
                const displaySteer = convertJetsonSteer(rawSteer);
                if (typeof window.updateSteeringFromServer === 'function') {
                    window.updateSteeringFromServer(displaySteer);
                }
            }

            // Tính toán FPS
            const now = performance.now();
            const elapsed = now - lastFrameTime;
            lastFrameTime = now;

            if (elapsed > 0) {
                const currentFps = 1000 / elapsed;
                fpsArray.push(currentFps);

                if (fpsArray.length > 10) {
                    fpsArray.shift();
                }

                const avgFps = fpsArray.reduce((a, b) => a + b, 0) / fpsArray.length;
                document.getElementById('fpsValue') && (document.getElementById('fpsValue').textContent = avgFps.toFixed(1));
            }

            frameCount++;

            if (timestamp) {
                const latency = receiveTime - new Date(timestamp).getTime();
                document.getElementById('latencyValue') && (document.getElementById('latencyValue').textContent = Math.max(0, latency.toFixed(0)));
            }
        } catch (error) {
            console.error("Error processing data:", error);
        }
    };
}

// Gửi lệnh điều khiển đến Jetson
function sendCommandToJetson(command) {
    if (!isConnected || !ws) {
        console.warn(`Không thể gửi lệnh "${command}" vì chưa kết nối đến Jetson`);
        return false;
    }
    
    try {
        const message = {
            type: "command",
            command: command
        };
        
        ws.send(JSON.stringify(message));
        console.log(`Đã gửi lệnh "${command}" đến Jetson`);
        return true;
    } catch (error) {
        console.error(`Lỗi khi gửi lệnh "${command}":`, error);
        return false;
    }
}

// Gửi mã lệnh dạng đặc biệt đến Jetson (ví dụ: "#kl:30;;\r\n")
function sendSpecialCommandToJetson(command) {
    if (!isConnected || !ws) {
        console.warn(`Không thể gửi lệnh đặc biệt "${command}" vì chưa kết nối đến Jetson`);
        return false;
    }
    
    try {
        // Gửi trực tiếp chuỗi lệnh, không đóng gói JSON
        ws.send(command);
        console.log(`Đã gửi lệnh đặc biệt "${command}" đến Jetson`);
        return true;
    } catch (error) {
        console.error(`Lỗi khi gửi lệnh đặc biệt "${command}":`, error);
        return false;
    }
}

// Xử lý ngắt kết nối
function handleJetsonDisconnect() {
    isConnected = false;
    streamActive = false;

    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.textContent = 'Lost connection';
        statusElement.className = 'connection-status-indicator disconnected';
    }

    const connectBtn = document.getElementById('connectJetsonBtn');
    if (connectBtn) connectBtn.disabled = false;

    const disconnectBtn = document.getElementById('disconnectJetsonBtn');
    if (disconnectBtn) disconnectBtn.disabled = true;

    const fpsElement = document.getElementById('fpsValue');
    if (fpsElement) fpsElement.textContent = '0';

    const latencyElement = document.getElementById('latencyValue');
    if (latencyElement) latencyElement.textContent = '0';

    if (ws) {
        ws.close();
        ws = null;
    }
}

// Hàm ngắt kết nối có chủ ý
function disconnectFromJetson() {
    if (isConnected) {
        document.getElementById('connectionStatus').textContent = 'Disconnecting...';
        document.getElementById('connectionStatus').className = 'connection-status-indicator disconnecting';

        setTimeout(function() {
            if (ws) {
                ws.close();
                ws = null;
            }
            handleJetsonDisconnect();
        }, 500);
    }
}

// Thiết lập đồng hồ tốc độ
function setupSpeedGauge() {
    const speedArc = document.querySelector('.ellipse-16');
    const speedValue = document.querySelector('._57');

    if (!speedArc || !speedValue) {
        console.error("Không tìm thấy phần tử đồng hồ tốc độ");
        return;
    }

    console.log("Đã tìm thấy phần tử đồng hồ tốc độ:", {
        speedArc: speedArc.className,
        speedValue: speedValue.className
    });

    speedArc.style.transition = 'clip-path 0.3s ease';
    speedArc.style.clipPath = 'inset(0 100% 0 0)';

    let currentSpeed = 0;
    const maxSystemSpeed = 60;
    const maxDisplaySpeed = 50;
    const speedStep = 5;
    let keyPressed = false;
    let keyPressTimer = null;

    updateSpeedUI(currentSpeed, speedArc, speedValue, maxDisplaySpeed);

    // Loại bỏ điều khiển bằng bàn phím - chỉ hiển thị thông tin từ Jetson
    console.log("Thiết lập đồng hồ tốc độ - chỉ chế độ hiển thị, không điều khiển bằng bàn phím");
    
    // Hiển thị thông báo trên bảng điều khiển
    const speedNoticeElement = document.createElement('div');
    speedNoticeElement.className = 'speed-notice';
    speedNoticeElement.textContent = 'Tốc độ được điều khiển từ Jetson';
    speedNoticeElement.style.position = 'absolute';
    speedNoticeElement.style.bottom = '10px';
    speedNoticeElement.style.width = '100%';
    speedNoticeElement.style.textAlign = 'center';
    speedNoticeElement.style.color = '#ffffff';
    speedNoticeElement.style.fontSize = '12px';
    speedNoticeElement.style.opacity = '0.7';
    speedNoticeElement.style.display = 'none'; // Ẩn đi
    
    const gaugeContainer = document.querySelector('.group-84') || document.querySelector('.group-141');
    if (gaugeContainer) {
        gaugeContainer.appendChild(speedNoticeElement);
    }

    displayKeyboardHelp();
}

// Đã loại bỏ hàm sendSpeedValueToJetson() vì không còn điều khiển từ giao diện

// Cập nhật UI đồng hồ tốc độ
function updateSpeedUI(speed, ellipse16, speedValue, maxDisplaySpeed = 50) {
    const displaySpeed = Math.min(speed, maxDisplaySpeed);
    const actualSpeed = speed;

    if (speedValue) {
        speedValue.textContent = Math.round(displaySpeed);
        console.log("Đã cập nhật giá trị hiển thị thành:", Math.round(displaySpeed));

        speedValue.style.transition = 'color 0.2s ease';
        speedValue.style.color = '#e86975';

        setTimeout(() => {
            speedValue.style.color = '#ffffff';
        }, 200);
    } else {
        console.warn("Không tìm thấy phần tử hiển thị tốc độ (_57)");
    }

    if (ellipse16) {
        const adjustedMaxSpeed = 60;
        const percentage = actualSpeed / adjustedMaxSpeed;

        if (percentage <= 0) {
            ellipse16.style.clipPath = 'inset(0 100% 0 0)';
        } else {
            const clipPercentage = 100 - (percentage * 100);
            ellipse16.style.clipPath = `inset(0 ${clipPercentage}% 0 0)`;
        }

        console.log(`Tốc độ: ${speed}, Hiển thị: ${displaySpeed}, Phần trăm: ${percentage}, Clip-path: inset(0 ${100 - (percentage * 100)}% 0 0)`);
    } else {
        console.warn("Không tìm thấy phần tử ellipse-16");
    }

    updateDebugInfo(Math.round(displaySpeed), ellipse16 ? true : false);
}