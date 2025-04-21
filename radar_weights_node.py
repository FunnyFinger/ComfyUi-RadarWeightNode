import json
import os
from server import PromptServer
from aiohttp import web

# Global dictionary to store current weights for each node
CURRENT_WEIGHTS = {}

# Path for persistent storage
STORAGE_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "storage")
WEIGHTS_FILE = os.path.join(STORAGE_DIR, "radar_weights_weights.json")

# Ensure storage directory exists
os.makedirs(STORAGE_DIR, exist_ok=True)

# Load saved weights if they exist
def load_saved_weights():
    global CURRENT_WEIGHTS
    if os.path.exists(WEIGHTS_FILE):
        try:
            with open(WEIGHTS_FILE, 'r') as f:
                CURRENT_WEIGHTS = json.load(f)
            print(f"[Radar Weights] Loaded {len(CURRENT_WEIGHTS)} saved weights from {WEIGHTS_FILE}")
        except Exception as e:
            print(f"[Radar Weights] Error loading saved weights: {e}")
            CURRENT_WEIGHTS = {}

# Save weights to file
def save_weights():
    try:
        with open(WEIGHTS_FILE, 'w') as f:
            json.dump(CURRENT_WEIGHTS, f)
        print(f"[Radar Weights] Saved {len(CURRENT_WEIGHTS)} weights to {WEIGHTS_FILE}")
    except Exception as e:
        print(f"[Radar Weights] Error saving weights: {e}")

# Load saved weights on module import
load_saved_weights()

class RadarWeightsNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "axes_count": ("INT", {
                    "default": 5,
                    "min": 3,
                    "max": 10,
                    "step": 1,
                    "display": "number"
                })
            },
            "hidden": {
                "_weights_sync": ("STRING", {"default": ""}),
                "unique_id": "UNIQUE_ID"
            }
        }

    # Define dynamic RETURN_TYPES and RETURN_NAMES based on max possible axes
    RETURN_TYPES = tuple(["FLOAT"] * 10)  # Support up to 10 axes
    RETURN_NAMES = tuple([str(i+1) for i in range(10)])  # Name them "1" through "10"

    FUNCTION = "generate"
    CATEGORY = "Spider/Widgets"

    def generate(self, axes_count, **kwargs):
        # Get node ID from kwargs
        node_id = kwargs.get('unique_id')
        _weights_sync = kwargs.get('_weights_sync', "") # Keep for logging/debugging

        print(f"[Radar Weights] Generate called for node {node_id}")
        # print(f"[Spider Widget] Full kwargs received: {kwargs}") # Optional: uncomment for deep debug
        print(f"[Radar Weights] Current weights in global state: {CURRENT_WEIGHTS}")
        # print(f"[Spider Widget] Sync widget value received: {_weights_sync}") # Optional: uncomment for deep debug

        weights_string = None
        node_id_str = str(node_id) if node_id else None

        # Primarily rely on the global state updated by the API
        if node_id_str and node_id_str in CURRENT_WEIGHTS:
            weights_string = CURRENT_WEIGHTS[node_id_str]
            print(f"[Radar Weights] Using weights from global state for node {node_id_str}: {weights_string}")
        else:
            # If no weights found for this node, use defaults
            print(f"[Radar Weights] No weights found for node {node_id_str}. Using default weights.")
            # Create default weights based on axes_count
            default_weights = [1.0] * axes_count
            weights_string = ",".join(["{:.2f}".format(w) for w in default_weights])
            
            # Store these default weights in the global state
            if node_id_str:
                CURRENT_WEIGHTS[node_id_str] = weights_string
                print(f"[Radar Weights] Stored default weights for node {node_id_str}: {weights_string}")
                # Save weights to persistent storage
                save_weights()

        # Parse weights from string
        try:
            current_weights = [float(w.strip()) for w in weights_string.split(',') if w.strip()]

            # Ensure the list matches axes_count (pad or truncate)
            if len(current_weights) != axes_count:
                print(f"[Radar Weights] Adjusting weights length ({len(current_weights)}) to match axes_count ({axes_count}) for node {node_id_str}.")
                if len(current_weights) < axes_count:
                    current_weights.extend([1.0] * (axes_count - len(current_weights)))
                else:
                    current_weights = current_weights[:axes_count]

        except Exception as e:
            print(f"[Error] RadarWeightsNode: Failed to parse weights for node {node_id_str}. Error: {e}. Using defaults.")
            current_weights = [1.0] * axes_count

        # Format weights for potential storage update (though API handles primary update)
        # We format for storage/API, but round for output
        formatted_weights = ["{:.2f}".format(w) for w in current_weights]
        updated_weights_string = ",".join(formatted_weights)

        # Round the weights for output to two decimal places
        rounded_weights = [round(w, 2) for w in current_weights]

        print(f"[Radar Weights] Returning rounded weights for node {node_id_str}: {rounded_weights}")

        # Pad with zeros to match max number of outputs (10)
        padded_weights = rounded_weights + [0.0] * (10 - len(rounded_weights))
        return tuple(padded_weights)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # sync_val = kwargs.get('_weights_sync', '') # No longer rely on this potentially stale value
        unique_id = kwargs.get('unique_id', '')
        axes_count = kwargs.get('axes_count', 5)

        # The hash should depend only on the user-controlled input (axes_count)
        # and the actual state stored in the backend (CURRENT_WEIGHTS retrieved via unique_id).
        node_id_str = str(unique_id) if unique_id else "-1"
        current_weights_str = CURRENT_WEIGHTS.get(node_id_str, "") # Get the ground truth from global state

        print(f"[Radar Weights] IS_CHANGED called for node {node_id_str}. Axes: {axes_count}, Current Backend Weights: {current_weights_str}")

        # Create a hash based *only* on reliable data
        return f"{unique_id}-{axes_count}-{current_weights_str}"

# API endpoint to handle weight updates
@PromptServer.instance.routes.post("/radar_weights/update_weights")
async def update_weights_route(request):
    try:
        data = await request.json()
        node_id = data.get('node_id')
        weights = data.get('weights')
        
        if not node_id or not weights:
            return web.json_response({"error": "Missing node_id or weights"}, status=400)
            
        print(f"[Radar Weights] API received update for node {node_id}: {weights}")
        CURRENT_WEIGHTS[str(node_id)] = weights
        print(f"[Radar Weights] Updated weights for node {node_id}: {weights}")
        print(f"[Radar Weights] Current global state: {CURRENT_WEIGHTS}")
        
        # Save weights to persistent storage
        save_weights()
        
        return web.json_response({
            "status": "success",
            "node_id": node_id,
            "weights": weights
        })
    except Exception as e:
        print(f"[Radar Weights] Error in update_weights_route: {str(e)}")
        return web.json_response({"error": str(e)}, status=500)

# Add a route to get the current weights for a node
@PromptServer.instance.routes.get("/radar_weights/get_weights/{node_id}")
async def get_weights_route(request):
    try:
        node_id = request.match_info.get('node_id')
        if not node_id:
            return web.json_response({"error": "Missing node_id"}, status=400)
            
        weights = CURRENT_WEIGHTS.get(str(node_id), "")
        print(f"[Radar Weights] Retrieved weights for node {node_id}: {weights}")
        
        return web.json_response({
            "status": "success",
            "node_id": node_id,
            "weights": weights
        })
    except Exception as e:
        print(f"[Radar Weights] Error in get_weights_route: {str(e)}")
        return web.json_response({"error": str(e)}, status=500)

# Add a route to get the most recent weights
@PromptServer.instance.routes.get("/radar_weights/get_latest_weights")
async def get_latest_weights_route(request):
    try:
        if not CURRENT_WEIGHTS:
            return web.json_response({
                "status": "success",
                "weights": ""
            })
            
        # Get the last key-value pair from the dictionary
        last_node_id, last_weights = list(CURRENT_WEIGHTS.items())[-1]
        print(f"[Radar Weights] Retrieved latest weights from node {last_node_id}: {last_weights}")
        
        return web.json_response({
            "status": "success",
            "node_id": last_node_id,
            "weights": last_weights
        })
    except Exception as e:
        print(f"[Radar Weights] Error in get_latest_weights_route: {str(e)}")
        return web.json_response({"error": str(e)}, status=500)

# Add a route to get all saved weights
@PromptServer.instance.routes.get("/radar_weights/get_all_weights")
async def get_all_weights_route(request):
    try:
        return web.json_response({
            "status": "success",
            "weights": CURRENT_WEIGHTS
        })
    except Exception as e:
        print(f"[Radar Weights] Error in get_all_weights_route: {str(e)}")
        return web.json_response({"error": str(e)}, status=500)

# It's good practice to update the NODE_CLASS_MAPPINGS if this file defines it
# Assuming it might be in __init__.py or similar, but adding here for completeness if stand-alone
NODE_CLASS_MAPPINGS = {
    "RadarWeightsNode": RadarWeightsNode 
}

# Optionally, update display name mapping
NODE_DISPLAY_NAME_MAPPINGS = {
    "RadarWeightsNode": "Radar Weights Node" 
}

# If web directory registration exists, update it (less common in single file nodes)
# WEB_DIRECTORY = "./js" 