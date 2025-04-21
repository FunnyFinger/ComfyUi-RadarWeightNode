from .radar_weights_node import RadarWeightsNode

WEB_DIRECTORY = "js" # Let ComfyUI know where to serve JS files from

NODE_CLASS_MAPPINGS = {
    "RadarWeightsNode": RadarWeightsNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RadarWeightsNode": "Radar Weights Node"
}

# Tell ComfyUI which variables to look for
__all__ = ['NODE_CLASS_MAPPINGS', 'NODE_DISPLAY_NAME_MAPPINGS', 'WEB_DIRECTORY']
