import { app } from "/scripts/app.js";

console.log("[Radar Weights] Registering extension...");

// --- Base Dimensions ---
const BASE_RADIUS = 250;                            // Our fundamental radius unit
const CANVAS_SIZE = BASE_RADIUS * 2;                // Canvas size derived from radius
const NODE_WIDTH = CANVAS_SIZE +40;                 // Fixed node width

// --- Key Heights (from title bar) ---
const TITLE_HEIGHT = 10;                // Reduced title bar height
const WIDGET_Y = TITLE_HEIGHT;          // Position widget closer to title
const WIDGET_HEIGHT = 20;               // HEIGHT OF WIDGETS (HARDCODED IN COMFYUI)
const PORTS_CIRCLE_Y = BASE_RADIUS+TITLE_HEIGHT+WIDGET_HEIGHT+40;               // Fixed distance from title to ports circle center
const RADAR_Y = BASE_RADIUS+TITLE_HEIGHT+WIDGET_HEIGHT;                         // Fixed distance from title to RADAR center
const NODE_HEIGHT = PORTS_CIRCLE_Y + WIDGET_HEIGHT + TITLE_HEIGHT;    // Node height based on ports circle

// --- Derived Radii ---
const RADAR_RADIUS = BASE_RADIUS - 20;  // Radar radius with margin
const PORT_CIRCLE_RADIUS = 6;           // Size of port circles
const POINT_RADIUS = 8;                 // Size of control points
const POINT_RADIUS_HOVER = 10;          // Size of control points when hovered
const POINT_HIT_RADIUS = 15;            // Hit detection radius for points

// --- Other Constants ---
const MAX_VALUE = 2.0;               // Maximum value for weights
const DEFAULT_WEIGHT = 1.0;          // Default weight value
const MIN_AXES = 3;                  // Minimum number of axes
const MAX_AXES = 10;                 // Maximum number of axes
const DEFAULT_AXES = 5;              // Default number of axes
const REFERENCE_CIRCLES = [
    { value: 0.5, label: "0.5", color: "#b8b8b8" },
    { value: 1.0, label: "1.0", color: "#b58d8d" },
    { value: 1.5, label: "1.5", color: "#b35454" },
    { value: 2.0, label: "2.0", color: "#bf1f1f" }
];



// Calculate optimal header offset based on node dimensions and radar size
function calculateOptimalHeaderOffset() {
    const portRadius = BASE_RADIUS;
    const radarRadius = BASE_RADIUS;
    const offset = portRadius - radarRadius;
    console.log("[Radar Weights] Calculated optimal header offset:", offset);
    return offset;
}

app.registerExtension({
    name: "Comfy.Spider.RadarWeightsNode",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name === "RadarWeightsNode" || nodeData.name === "Radar Weights Node") {
            console.log("[Radar Weights] Configuring RadarWeightsNode size");
            
            // Store original methods
            const origComputeSize = nodeType.prototype.computeSize;
            const origSerialize = nodeType.prototype.serialize;
            const origOnConfigure = nodeType.prototype.onConfigure;
            
            // Override size computation
            nodeType.prototype.computeSize = function(out) {
                 // Compute default size first if needed (optional)
                 // let size = origComputeSize ? origComputeSize.call(this, out) : [300, 200]; 
                 // Always return our fixed size
                return [NODE_WIDTH, NODE_HEIGHT];
            };
            
            // Override serialization to save node state
            nodeType.prototype.serialize = function() {
                let data = origSerialize ? origSerialize.call(this) : {};
                
                // Save axes count and weights
                const axesCountWidget = this.widgets?.find(w => w.name === "axes_count");
                const weightsWidget = this.widgets?.find(w => w.name === "_weights_sync");
                
                data.axes_count = axesCountWidget?.value ?? DEFAULT_AXES;
                data.weights = weightsWidget?.value ?? "";
                
                // Generate a unique ID if it doesn't exist
                if (!this.properties) {
                    this.properties = {};
                }
                
                if (!this.properties.unique_id) {
                    this.properties.unique_id = `radar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    console.log(`[Radar Weights] Generated new unique_id: ${this.properties.unique_id}`);
                }
                
                data.unique_id = this.properties.unique_id;
                
                return data;
            };
            
            // Override onDrawForeground to draw ports
            const origOnDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function(ctx) {
                 // Call original foreground drawing first
                 if (origOnDrawForeground) {
                     origOnDrawForeground.apply(this, arguments);
                 }

                 // Draw ports if outputs exist
                 if (this.outputs && this.outputs.length > 0) {
                    const numAxes = this.outputs.length;
                     // Calculate center for the port circle (relative to node's top-left)
                     // Use node width for x-centering, PORTS_CIRCLE_Y for fixed y
                    const center = {
                         x: this.size[0] / 2, 
                        y: PORTS_CIRCLE_Y
                    };

                    for (let i = 0; i < numAxes; i++) {
                         const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2; // Start at top
                         const portX = center.x + BASE_RADIUS * Math.cos(angle);
                         const portY = center.y + BASE_RADIUS * Math.sin(angle);

                         // IMPORTANT: Update the output slot position for LiteGraph linking
                         this.outputs[i].pos = [portX, portY];
                         // Optional: Adjust link position slightly if needed
                         // this.outputs[i].link_pos = [portX, portY]; 

                         // Draw the port circle visualization
                         ctx.fillStyle = this.outputs[i].link ? "#7F7" : "#666"; // Color depends on connection
                        ctx.strokeStyle = "#999";
                        ctx.lineWidth = 1;
                         ctx.beginPath();
                         ctx.arc(portX, portY, PORT_CIRCLE_RADIUS, 0, Math.PI * 2);
                         ctx.fill();
                        ctx.stroke();
                    }
                 }
             };
            
            // Store the original onConfigure method on the prototype
            nodeType.prototype._originalOnConfigure = origOnConfigure;
            
            // --- Define methods on the prototype --- 

            // Function to update output ports (now on prototype)
            nodeType.prototype.updateOutputPorts = function(requiredCount = -1) {
                try {
                    // Use this.weights if available, otherwise default to 0 if requiredCount is not given
                    const numAxes = requiredCount >= 0 ? requiredCount : (this.weights ? this.weights.length : 0);
                    if (numAxes <= 0) {
                         console.warn("[Radar Weights] updateOutputPorts called with zero axes.");
                         while (this.outputs?.length > 0) {
                              this.removeOutput(0);
                         }
                         return; 
                    }
                    
                    console.log(`[Radar Weights] Updating ports to ${numAxes} axes for node ${this.id}.`);

                    if (this.outputs?.length !== numAxes) {
                        while (this.outputs?.length > 0) {
                            this.removeOutput(0);
                        }
                        for (let index = 0; index < numAxes; index++) {
                            this.addOutput(`${index + 1}`, "FLOAT");
                        }
                    }

                    this.setDirtyCanvas(true);
                } catch (error) {
                    console.error("[Radar Weights] Error updating output ports:", error);
                }
            };
            
            // Function to get radar center (now on prototype)
            nodeType.prototype.getRadarCenter = function() {
            return {
                x: CANVAS_SIZE / 2,
                y: CANVAS_SIZE / 2
            };
            };

            // Function to draw the radar chart (now on prototype)
            nodeType.prototype.drawRadar = function() {
                if (!this.ctx || !this.weights || this.weights.length === 0) {
                    // console.warn("[Spider Widget] drawRadar called too early or with no weights/context.");
                    return; // Exit if context or weights aren't ready
                }
                const numAxes = this.weights.length;
                const center = this.getRadarCenter(); // Use helper method
                
                this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

                // Draw reference circles
                this.ctx.setLineDash([4, 4]);
                this.ctx.lineWidth = 2;
                this.ctx.font = "12px Arial";
                this.ctx.textAlign = "center";
                this.ctx.textBaseline = "middle";
            const sortedCircles = [...REFERENCE_CIRCLES].sort((a, b) => a.value - b.value);
            sortedCircles.forEach(circle => {
                const circleRadius = RADAR_RADIUS * (circle.value / MAX_VALUE);
                    this.ctx.strokeStyle = circle.color;
                    this.ctx.beginPath();
                    this.ctx.arc(center.x, center.y, circleRadius, 0, Math.PI * 2);
                    this.ctx.stroke();
                const labelX = center.x + circleRadius - 15;
                const labelY = center.y;
                    this.ctx.fillStyle = "rgba(128, 128, 128, 0.8)";
                    this.ctx.fillText(circle.label, labelX, labelY);
            });

            // Draw axes lines
                this.ctx.setLineDash([]);
                this.ctx.strokeStyle = "#555";
                this.ctx.lineWidth = 1;
            for (let i = 0; i < numAxes; i++) {
                const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2;
                const lineEndX = center.x + RADAR_RADIUS * Math.cos(angle);
                const lineEndY = center.y + RADAR_RADIUS * Math.sin(angle);
                    this.ctx.beginPath();
                    this.ctx.moveTo(center.x, center.y);
                    this.ctx.lineTo(lineEndX, lineEndY);
                    this.ctx.stroke();
                }

                // Draw data polygon
                this.ctx.beginPath();
            const polygonPoints = [];
            for(let i = 0; i < numAxes; i++) {
                const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2;
                    const valueRatio = Math.max(0, Math.min(this.weights[i] / MAX_VALUE, 1.0));
                const pointRadius = RADAR_RADIUS * valueRatio;
                const x = center.x + pointRadius * Math.cos(angle);
                const y = center.y + pointRadius * Math.sin(angle);
                polygonPoints.push({ x, y });
                    if (i === 0) this.ctx.moveTo(x, y); else this.ctx.lineTo(x, y);
                }
                this.ctx.closePath();
                this.ctx.strokeStyle = "#008CBA";
                this.ctx.fillStyle = "rgba(0, 140, 186, 0.3)";
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
                this.ctx.fill();

            // Draw interactive points
            polygonPoints.forEach((p, i) => {
                    this.ctx.beginPath();
                    const pointRadius = (i === this.hoveredPointIndex) ? POINT_RADIUS_HOVER : POINT_RADIUS;
                    const fillStyle = (i === this.hoveredPointIndex) ? "#00BFFF" : "#008CBA";
                    this.ctx.fillStyle = fillStyle;
                    this.ctx.arc(p.x, p.y, pointRadius, 0, Math.PI * 2);
                    this.ctx.fill();
                });
            };
            
            // Function to get point index at canvas coordinates (now on prototype)
            nodeType.prototype.getPointIndexAt = function(canvasX, canvasY) {
                if (!this.weights || this.weights.length === 0 || !this.canvas) return -1;
                const numAxes = this.weights.length;
                const centerX = CANVAS_SIZE / 2; // Use constant as canvas size is fixed
            const centerY = CANVAS_SIZE / 2;

            for (let i = 0; i < numAxes; i++) {
                const angle = (Math.PI * 2 / numAxes) * i - Math.PI / 2;
                    const valueRatio = Math.max(0, Math.min(this.weights[i] / MAX_VALUE, 1.0));
                const pointRadius = RADAR_RADIUS * valueRatio;
                const x = centerX + pointRadius * Math.cos(angle);
                const y = centerY + pointRadius * Math.sin(angle);
                const dx = canvasX - x;
                const dy = canvasY - y;
                const distanceSq = dx * dx + dy * dy;
                    if (distanceSq < POINT_HIT_RADIUS * POINT_HIT_RADIUS) return i;
            }
            return -1;
            };

            // Function to update backend and widget (now on prototype)
            nodeType.prototype.updateBackendAndWidget = async function(newWeights) {
            try {
                // Update the hidden widget safely
                    const syncWidget = this.widgets.find(w => w.name === "_weights_sync");
                if (syncWidget) {
                         syncWidget.value = newWeights.join(',');
                         console.log("[Radar Weights] Updated _weights_sync widget with:", newWeights.join(','));
                    } else {
                         console.warn("[Radar Weights] Could not find _weights_sync widget to update.");
                    }

                    // Update backend via API using node.id
                const response = await fetch('/radar_weights/update_weights', {
                    method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ node_id: this.id, weights: newWeights.join(',') })
                    });
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                console.log("[Radar Weights] API update response:", data);
                
                    // Mark graph dirty and update outputs
                    if (this.graph) {
                        this.graph.setDirtyCanvas(true, false);
                        this.updateNodeOutputs(newWeights); // Call prototype method
                }
            } catch (error) {
                console.error("[Radar Weights] Error updating backend:", error);
            }
            };

            // Function to directly update output values (now on prototype)
            nodeType.prototype.updateNodeOutputs = function(newWeights) {
                if (!this.outputs) return;
            newWeights.forEach((weight, i) => {
                    if (i < this.outputs.length) {
                        const numericWeight = parseFloat(weight);
                        this.outputs[i].value = numericWeight; // Directly set value
                        // Update links connected to this output
                        if (this.graph && this.getOutputLinks) {
                            const links = this.getOutputLinks(i);
                            if (links) {
                            links.forEach(linkId => {
                                    const link = this.graph.links[linkId];
                                    if (link && link.data !== numericWeight) {
                                        link.data = numericWeight;
                }
            });
        }
                        }
                    }
                });
            };

            // Function to ensure output values are properly synced (now on prototype)
            nodeType.prototype.updateOutputValues = function() { 
                 const syncWidget = this.widgets.find(w => w.name === "_weights_sync");
                 if (syncWidget) {
                     syncWidget.value = this.weights.join(',');
                 }
                 this.updateNodeOutputs(this.weights);
                 if (this.graph) {
                     this.graph.setDirtyCanvas(true, false);
                 }
            };

             // Function to update number of axes (now on prototype)
            nodeType.prototype.updateAxesCount = async function(count) {
                const currentCount = this.weights ? this.weights.length : 0;
                const newCount = Math.max(MIN_AXES, Math.min(MAX_AXES, parseInt(count, 10)));
                
                if (newCount === currentCount) return; // No change needed
                if (!this.weights) this.weights = []; // Ensure weights array exists
                if (!this.labels) this.labels = []; // Ensure labels array exists
                if (!this.previousWeights) this.previousWeights = {}; // Ensure previous weights object exists

                console.log(`[Radar Weights] Updating axes count from ${currentCount} to ${newCount} for node ${this.id}`);
                
                // --- Store current weights before resizing --- 
                this.weights.forEach((weight, index) => {
                    this.previousWeights[index] = weight;
                });
                console.log("[Radar Weights] Stored current weights:", this.previousWeights);

                // Create a new weights array, preserving/retrieving existing values
                const oldWeights = [...this.weights]; // Keep this for length check
                const newWeights = [];
                for (let i = 0; i < newCount; i++) {
                    let weightToUse = DEFAULT_WEIGHT; // Default fallback
                    if (i < oldWeights.length) {
                        // Within old bounds, use the current weight
                        weightToUse = oldWeights[i];
                    } else if (this.previousWeights[i] !== undefined) {
                        // Beyond old bounds, but we have a stored value
                        weightToUse = this.previousWeights[i];
                        console.log(`[Radar Weights] Retrieved stored weight for index ${i}: ${weightToUse}`);
                    } 
                    // else: Beyond old bounds and no stored value, use DEFAULT_WEIGHT (already set)
                    newWeights.push(weightToUse);
                }
                this.weights = newWeights; // Update instance property AFTER loop
                
                // Update labels array
                this.labels = Array.from({length: newCount}, (_, i) => (i + 1).toString());
                console.log("[Radar Weights] New weights array:", this.weights);

                // Update output ports to match new count
                this.updateOutputPorts(newCount);
                
                // Update the hidden widget and backend
                await this.updateBackendAndWidget(this.weights);

                // Update output values AFTER ports are updated
                this.updateNodeOutputs(this.weights);
                
                // Redraw the radar
                requestAnimationFrame(() => this.drawRadar());
            };

            // Function to restore state (now on prototype)
            nodeType.prototype.restoreState = async function() {
                try {
                    const nodeId = this.id;
                    console.log(`[Radar Weights] Attempting restoreState for node ${nodeId}`);
                    const response = await fetch(`/radar_weights/get_weights/${nodeId}`);
                    const data = await response.json();

                    if (data.status === 'success' && data.weights && data.weights.trim() !== '') {
                        const fetchedWeights = data.weights.split(',').map(w => parseFloat(w.trim())).filter(n => !isNaN(n));
                        if (fetchedWeights.length === 0) throw new Error('Fetched empty weight list');

                        const axesNeeded = fetchedWeights.length;
                        const axesWidget = this.widgets.find(w => w.name === 'axes_count');
                        
                        // Update internal arrays FIRST
                        this.weights = Array.from(fetchedWeights);
                        this.labels = Array.from({ length: axesNeeded }, (_, i) => (i + 1).toString());

                        let portsChanged = false; // Flag to track if ports were recreated
                        // Update ports if needed 
                        if (axesWidget && axesWidget.value !== axesNeeded) {
                            axesWidget.value = axesNeeded;
                            this.updateOutputPorts(axesNeeded); 
                            portsChanged = true;
                        } else if (this.outputs?.length !== axesNeeded) {
                             this.updateOutputPorts(axesNeeded);
                             portsChanged = true;
                        }

                        // Sync hidden widget
                        const syncWidget = this.widgets.find(w => w.name === '_weights_sync');
                        if (syncWidget) syncWidget.value = this.weights.join(',');

                        // Update output VALUES now that ports are correct
                        this.updateNodeOutputs(this.weights);

                        // If ports were recreated, force size update
                        if (portsChanged) {
                             this.size = this.computeSize(); 
                        }

                        // Draw radar
                        requestAnimationFrame(() => this.drawRadar());
                        console.log(`[Radar Weights] Restored state for node ${nodeId}.`);
                    } else {
                         console.warn(`[Radar Weights] No valid weights found for node ${nodeId} during restoreState. Using defaults or existing.`);
                         // Optionally initialize with defaults if weights are empty
                         if (!this.weights || this.weights.length === 0) {
                              const axesWidget = this.widgets.find(w => w.name === 'axes_count');
                              const currentCount = axesWidget ? parseInt(axesWidget.value, 10) : DEFAULT_AXES;
                              this.weights = Array(currentCount).fill(DEFAULT_WEIGHT);
                              this.labels = Array.from({ length: currentCount }, (_, i) => (i + 1).toString());
                              this.updateOutputPorts(currentCount); // Ensure ports exist
                              this.updateNodeOutputs(this.weights);
                              await this.updateBackendAndWidget(this.weights); // Save defaults
                              requestAnimationFrame(() => this.drawRadar());
                         } else {
                              // If weights exist but fetch failed, just draw what we have
                              requestAnimationFrame(() => this.drawRadar());
                         }
                         // Ensure size is correct even on fallback
                          this.size = this.computeSize();
                          requestAnimationFrame(() => this.drawRadar());
                    }
                } catch (error) {
                    console.error(`[Radar Weights] Error during restoreState for node ${this.id}: ${error}`);
                     // Fallback drawing, maybe with defaults if weights are missing
                     if (!this.weights || this.weights.length === 0) {
                           const axesWidget = this.widgets.find(w => w.name === 'axes_count');
                           const currentCount = axesWidget ? parseInt(axesWidget.value, 10) : DEFAULT_AXES;
                           this.weights = Array(currentCount).fill(DEFAULT_WEIGHT);
                           this.labels = Array.from({ length: currentCount }, (_, i) => (i + 1).toString());
                           this.updateOutputPorts(currentCount);
                           this.updateNodeOutputs(this.weights);
                     }
                    // Ensure size is correct even on error
                     this.size = this.computeSize();
                     requestAnimationFrame(() => this.drawRadar());
                }
            };

            // Override configuration to restore node state
            nodeType.prototype.onConfigure = function(config) {
                // Call the original onConfigure method if it exists
                if (this._originalOnConfigure) {
                    this._originalOnConfigure.call(this, config);
                }

                const isNewNode = !config.unique_id;
                
                if (isNewNode) {
                    console.log("[Radar Weights] Configuring new node.");
                    // Initialize ports for a new node based on default axes count?
                    // Might need adjustment depending on when default weights are set.
                     const axesWidget = this.widgets.find(w => w.name === 'axes_count');
                     const defaultCount = axesWidget ? parseInt(axesWidget.value, 10) : DEFAULT_AXES;
                     this.updateOutputPorts(defaultCount); 
                } else {
                    console.log(`[Radar Weights] Configuring restored node ${this.id}.`);
                    const axesWidget = this.widgets.find(w => w.name === 'axes_count');
                    let portCount = DEFAULT_AXES; // Fallback
                    if (axesWidget && config.axes_count !== undefined) {
                        const savedCount = parseInt(config.axes_count, 10);
                        axesWidget.value = savedCount;
                        portCount = savedCount;
                        console.log(`[Radar Weights] Set axes_count widget to ${savedCount} from config.`);
                    } else {
                         console.warn("[Radar Weights] axes_count missing in config, using default for initial ports.");
                    }
                    // Create initial ports based on saved/default count BEFORE link restoration
                    this.updateOutputPorts(portCount);
                }
            };
            
        }
    },
    async nodeCreated(node) {
        if (node.type !== "RadarWeightsNode" && node.title !== "Radar Weights Node") return;
        console.log(`[Radar Weights] Node created: ${node.id}`);

        // --- Initialize Instance Properties --- 
        node.weights = []; // Start empty, restoreState will populate
        node.labels = [];
        // node.previousWeights = {}; // Not strictly needed if backend is source of truth
        node.isDragging = false;
        node.draggedPointIndex = -1;
        node.hoveredPointIndex = -1;
        node.canvas = null; 
        node.ctx = null;   

        // --- Setup Properties and DOM --- 
        if (!node.properties) node.properties = {};
        if (!node.properties.unique_id) node.properties.unique_id = node.id; 

        const container = document.createElement("div");
        container.style.width = `${CANVAS_SIZE}px`;
        container.style.height = `${CANVAS_SIZE}px`;
        container.style.position = "absolute";
        container.style.left = "50%";
        container.style.transform = "translate(-50%, -50%)"; 
        container.style.top = `${RADAR_Y}px`; 
        container.style.overflow = "hidden";
        container.style.minWidth = `${CANVAS_SIZE}px`;
        container.style.minHeight = `${CANVAS_SIZE}px`;
        container.style.maxWidth = `${CANVAS_SIZE}px`;
        container.style.maxHeight = `${CANVAS_SIZE}px`;

        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_SIZE;
        canvas.height = CANVAS_SIZE;
        canvas.style.display = "block";
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.width = `${CANVAS_SIZE}px`;
        canvas.style.height = `${CANVAS_SIZE}px`;
        canvas.style.backgroundColor = "transparent";

        container.appendChild(canvas);
        node.canvas = canvas; 
        node.ctx = canvas.getContext("2d"); 

        // --- Widgets --- 
        const radarWidget = node.addDOMWidget("radar_display", "div", container, { serialize: false });
        Object.defineProperty(radarWidget, 'y', { get: () => WIDGET_Y + WIDGET_HEIGHT, set: function() {}, configurable: true });

        const axesCountWidget = node.widgets.find(w => w.name === "axes_count");
        if (axesCountWidget) {
            Object.defineProperties(axesCountWidget, { 'y': { get: () => WIDGET_Y, set: function() {}, configurable: true } });
            const widgetIndex = node.widgets.indexOf(axesCountWidget);
            if (widgetIndex > 0) { node.widgets.splice(widgetIndex, 1); node.widgets.unshift(axesCountWidget); }
        } else {
            console.warn("[Radar Weights] Could not find axes_count widget during nodeCreated.");
        }
        
        // --- Event Listeners --- 
        canvas.addEventListener('mousedown', (e) => {
             const rect = node.canvas.getBoundingClientRect();
             const x = ((e.clientX - rect.left) / rect.width) * node.canvas.width;
             const y = ((e.clientY - rect.top) / rect.height) * node.canvas.height;
             node.draggedPointIndex = node.getPointIndexAt(x, y);
             if (node.draggedPointIndex !== -1) {
                 node.isDragging = true;
                 node.canvas.style.cursor = "grabbing";
            }
        });

        canvas.addEventListener('mousemove', (e) => {
             const rect = node.canvas.getBoundingClientRect();
             const mouseX = ((e.clientX - rect.left) / rect.width) * node.canvas.width;
             const mouseY = ((e.clientY - rect.top) / rect.height) * node.canvas.height;

             if (!node.isDragging) {
                 const currentHoverIndex = node.getPointIndexAt(mouseX, mouseY);
                 if (currentHoverIndex !== node.hoveredPointIndex) {
                     node.hoveredPointIndex = currentHoverIndex;
                     requestAnimationFrame(() => node.drawRadar());
                 }
                 node.canvas.style.cursor = (node.hoveredPointIndex !== -1) ? "grab" : "pointer";
             } else { 
                 if (node.draggedPointIndex === -1) return;
                 const numAxes = node.weights.length;
                 if (numAxes === 0) return; // Avoid errors if weights aren't loaded yet
            const radius = RADAR_RADIUS;
                 const centerX = node.canvas.width / 2;
                 const centerY = node.canvas.height / 2;
                 const angle = (Math.PI * 2 / numAxes) * node.draggedPointIndex - Math.PI / 2;
            const dx = mouseX - centerX;
            const dy = mouseY - centerY;
            const projectedLength = dx * Math.cos(angle) + dy * Math.sin(angle);
            const clampedLength = Math.max(0, Math.min(projectedLength, radius));
            const newValue = (clampedLength / radius) * MAX_VALUE;
                 const newWeights = [...node.weights];
                 newWeights[node.draggedPointIndex] = parseFloat(newValue.toFixed(2)); // Keep precision low
                 node.weights = newWeights; 
                 // Update backend immediately (no need to await here)
                 node.updateBackendAndWidget(newWeights);
                 // Redraw immediately
                 requestAnimationFrame(() => node.drawRadar());
             }
        });

        canvas.addEventListener('mouseup', () => {
             if (node.isDragging) {
                 node.isDragging = false;
                 node.draggedPointIndex = -1;
                 node.canvas.style.cursor = "pointer";
                 node.updateOutputValues();
             }
        });

        canvas.addEventListener('mouseleave', () => {
            if (node.hoveredPointIndex !== -1) {
                node.hoveredPointIndex = -1;
                requestAnimationFrame(() => node.drawRadar());
            }
            if (node.isDragging) {
                node.isDragging = false;
                node.draggedPointIndex = -1;
                node.canvas.style.cursor = "pointer";
                // Optionally call updateOutputValues here too if needed
                // node.updateOutputValues(); 
            }
        });

        // --- Hook Axes Count Widget --- 
        if (axesCountWidget) {
            const originalOnChange = axesCountWidget.callback;
            axesCountWidget.callback = (value) => { 
                if (originalOnChange) {
                    originalOnChange.call(axesCountWidget, value); 
                }
                // Call the method on the node instance
                node.updateAxesCount(value); 
            };
        } 

        // --- Final Setup --- 
        // Trigger state restoration after a short delay
        setTimeout(() => {
             node.restoreState();
        }, 400);
    },
    async setup() {
        console.log("[Radar Weights] Extension setup");
    }
});